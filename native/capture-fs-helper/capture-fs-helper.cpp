#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <limits.h>
#include <string>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <vector>

namespace {

constexpr size_t kMaxJsonBytes = 16 * 1024;

bool fail(const char *message) {
  std::fprintf(stderr, "capture-fs-helper: %s%s%s\n", message,
               errno ? ": " : "", errno ? std::strerror(errno) : "");
  return false;
}

bool isSafeLeaf(const char *value) {
  if (!value || !*value || std::strcmp(value, ".") == 0 ||
      std::strcmp(value, "..") == 0 || std::strlen(value) > NAME_MAX)
    return false;
  for (const unsigned char *cursor =
           reinterpret_cast<const unsigned char *>(value);
       *cursor; ++cursor) {
    if (!((*cursor >= 'a' && *cursor <= 'z') ||
          (*cursor >= 'A' && *cursor <= 'Z') ||
          (*cursor >= '0' && *cursor <= '9') || *cursor == '.' ||
          *cursor == '_' || *cursor == '-'))
      return false;
  }
  return true;
}

bool isSafeRelativePath(const char *value) {
  if (!value || !*value || value[0] == '/' || std::strlen(value) >= PATH_MAX)
    return false;
  const char *component = value;
  for (const char *cursor = value;; ++cursor) {
    if (*cursor != '/' && *cursor != '\0')
      continue;
    const size_t length = static_cast<size_t>(cursor - component);
    if (length == 0 || length > NAME_MAX ||
        (length == 1 && component[0] == '.') ||
        (length == 2 && component[0] == '.' && component[1] == '.'))
      return false;
    std::string leaf(component, length);
    if (!isSafeLeaf(leaf.c_str()))
      return false;
    if (*cursor == '\0')
      return true;
    component = cursor + 1;
  }
}

bool isOwnedPrivateDirectory(int fd) {
  struct stat status {};
  return fstat(fd, &status) == 0 && S_ISDIR(status.st_mode) &&
         status.st_uid == getuid() && (status.st_mode & 0077) == 0;
}

int duplicateDirectory(int fd) { return fcntl(fd, F_DUPFD_CLOEXEC, 3); }

int openDirectoryRelativeNoFollow(int root_fd, const char *relative) {
  if (!isSafeRelativePath(relative)) {
    errno = EINVAL;
    return -1;
  }
  int current = duplicateDirectory(root_fd);
  if (current < 0)
    return -1;
  const char *component = relative;
  for (const char *cursor = relative;; ++cursor) {
    if (*cursor != '/' && *cursor != '\0')
      continue;
    std::string leaf(component, static_cast<size_t>(cursor - component));
    int next = openat(current, leaf.c_str(),
                      O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    close(current);
    if (next < 0)
      return -1;
    if (!isOwnedPrivateDirectory(next)) {
      close(next);
      errno = EPERM;
      return -1;
    }
    if (*cursor == '\0')
      return next;
    current = next;
    component = cursor + 1;
  }
}

int openRegularRelativeNoFollow(int root_fd, const char *relative) {
  if (!isSafeRelativePath(relative)) {
    errno = EINVAL;
    return -1;
  }
  const char *slash = std::strrchr(relative, '/');
  const char *leaf = slash ? slash + 1 : relative;
  int parent = slash ? -1 : duplicateDirectory(root_fd);
  if (slash) {
    std::string directory(relative, static_cast<size_t>(slash - relative));
    parent = openDirectoryRelativeNoFollow(root_fd, directory.c_str());
  }
  if (parent < 0)
    return -1;
  int fd = openat(parent, leaf, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  close(parent);
  if (fd < 0)
    return -1;
  struct stat status {};
  if (fstat(fd, &status) != 0 || !S_ISREG(status.st_mode) ||
      status.st_uid != getuid() || status.st_nlink != 1 ||
      (status.st_mode & 0077) != 0 || status.st_size <= 0 ||
      static_cast<uintmax_t>(status.st_size) > kMaxJsonBytes) {
    close(fd);
    errno = EPERM;
    return -1;
  }
  return fd;
}

bool readExactly(int fd, size_t expected, std::vector<unsigned char> *out) {
  out->resize(expected);
  size_t offset = 0;
  while (offset < expected) {
    ssize_t count = read(fd, out->data() + offset, expected - offset);
    if (count <= 0)
      return false;
    offset += static_cast<size_t>(count);
  }
  unsigned char extra = 0;
  if (read(fd, &extra, 1) != 0) {
    errno = EFBIG;
    return false;
  }
  return true;
}

bool isCompactJsonObject(const std::vector<unsigned char> &bytes) {
  if (bytes.size() < 2 || bytes.front() != '{' || bytes.back() != '}')
    return false;
  for (unsigned char byte : bytes)
    if (byte < 0x20 || byte > 0x7e)
      return false;
  return true;
}

bool writeExactly(int fd, const std::vector<unsigned char> &bytes) {
  size_t offset = 0;
  while (offset < bytes.size()) {
    ssize_t count = write(fd, bytes.data() + offset, bytes.size() - offset);
    if (count <= 0)
      return false;
    offset += static_cast<size_t>(count);
  }
  return true;
}

bool publishJson(const char *session_root, const char *source_relative,
                 const char *destination_directory_relative, const char *leaf) {
  if (!isSafeLeaf(leaf) || !isSafeRelativePath(source_relative) ||
      !isSafeRelativePath(destination_directory_relative)) {
    errno = EINVAL;
    return fail("unsafe control path");
  }
  int root = open(session_root, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (root < 0 || !isOwnedPrivateDirectory(root)) {
    if (root >= 0)
      close(root);
    errno = EPERM;
    return fail("session root must be an owned private directory");
  }
  int source = openRegularRelativeNoFollow(root, source_relative);
  if (source < 0) {
    close(root);
    return fail("source control rejected");
  }
  struct stat source_status {};
  const bool source_ok = fstat(source, &source_status) == 0;
  std::vector<unsigned char> bytes;
  const bool read_ok = source_ok &&
                       readExactly(source, static_cast<size_t>(source_status.st_size),
                                   &bytes);
  close(source);
  if (!read_ok || !isCompactJsonObject(bytes)) {
    close(root);
    if (!read_ok)
      return fail("source control changed while reading");
    errno = EINVAL;
    return fail("source control is not compact JSON");
  }
  int destination =
      openDirectoryRelativeNoFollow(root, destination_directory_relative);
  if (destination < 0) {
    close(root);
    return fail("destination control directory rejected");
  }
  char temporary[NAME_MAX + 1]{};
  int target = -1;
  for (unsigned int attempt = 0; attempt < 32; ++attempt) {
    const int count = std::snprintf(temporary, sizeof(temporary),
                                    ".capture-fs-%u-%u.tmp",
                                    static_cast<unsigned>(getpid()),
                                    static_cast<unsigned>(arc4random()));
    if (count <= 0 || static_cast<size_t>(count) >= sizeof(temporary)) {
      close(destination);
      close(root);
      errno = ENAMETOOLONG;
      return fail("temporary control filename failed");
    }
    target = openat(destination, temporary,
                    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
                    0600);
    if (target >= 0)
      break;
    if (errno != EEXIST) {
      close(destination);
      close(root);
      return fail("temporary control create failed");
    }
  }
  if (target < 0) {
    close(destination);
    close(root);
    errno = EEXIST;
    return fail("temporary control collision");
  }
  bool written = fchmod(target, 0600) == 0 && writeExactly(target, bytes) &&
                 fsync(target) == 0;
  if (close(target) != 0)
    written = false;
  if (!written) {
    unlinkat(destination, temporary, 0);
    close(destination);
    close(root);
    return fail("temporary control write/fsync failed");
  }
  if (renameatx_np(destination, temporary, destination, leaf, RENAME_EXCL) !=
      0) {
    unlinkat(destination, temporary, 0);
    close(destination);
    close(root);
    return fail("control publish collision or rename failed");
  }
  const bool synced = fsync(destination) == 0 && fsync(root) == 0;
  close(destination);
  close(root);
  if (!synced)
    return fail("control directory fsync failed");
  return true;
}

} // namespace

int main(int argc, char *argv[]) {
  if (argc != 6 || std::strcmp(argv[1], "publish-json") != 0) {
    std::fprintf(stderr,
                 "usage: capture-fs-helper publish-json SESSION_ROOT SOURCE_REL "
                 "DESTINATION_DIR_REL LEAF\n");
    return 64;
  }
  return publishJson(argv[2], argv[3], argv[4], argv[5]) ? 0 : 1;
}
