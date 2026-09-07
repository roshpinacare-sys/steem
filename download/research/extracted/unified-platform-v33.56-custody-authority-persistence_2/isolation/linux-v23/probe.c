#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/utsname.h>
#include <sys/wait.h>
#include <unistd.h>

#define ALLOW_SYSCALL(nr) \
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (nr), 0, 1), \
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)

static int install_limits(void) {
  struct rlimit limit;
  limit.rlim_cur = limit.rlim_max = 1; if (setrlimit(RLIMIT_CPU, &limit) != 0) return -1;
  limit.rlim_cur = limit.rlim_max = 32 * 1024 * 1024; if (setrlimit(RLIMIT_AS, &limit) != 0) return -1;
  limit.rlim_cur = limit.rlim_max = 4096; if (setrlimit(RLIMIT_FSIZE, &limit) != 0) return -1;
  limit.rlim_cur = limit.rlim_max = 1; if (setrlimit(RLIMIT_NPROC, &limit) != 0) return -1;
  limit.rlim_cur = limit.rlim_max = 16; if (setrlimit(RLIMIT_NOFILE, &limit) != 0) return -1;
  limit.rlim_cur = limit.rlim_max = 0; if (setrlimit(RLIMIT_CORE, &limit) != 0) return -1;
  return 0;
}

static int install_seccomp(void) {
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#ifdef __NR_read
    ALLOW_SYSCALL(__NR_read),
#endif
#ifdef __NR_write
    ALLOW_SYSCALL(__NR_write),
#endif
#ifdef __NR_openat
    ALLOW_SYSCALL(__NR_openat),
#endif
#ifdef __NR_close
    ALLOW_SYSCALL(__NR_close),
#endif
#ifdef __NR_newfstatat
    ALLOW_SYSCALL(__NR_newfstatat),
#endif
#ifdef __NR_fstat
    ALLOW_SYSCALL(__NR_fstat),
#endif
#ifdef __NR_lseek
    ALLOW_SYSCALL(__NR_lseek),
#endif
#ifdef __NR_brk
    ALLOW_SYSCALL(__NR_brk),
#endif
#ifdef __NR_mmap
    ALLOW_SYSCALL(__NR_mmap),
#endif
#ifdef __NR_munmap
    ALLOW_SYSCALL(__NR_munmap),
#endif
#ifdef __NR_mprotect
    ALLOW_SYSCALL(__NR_mprotect),
#endif
#ifdef __NR_rt_sigaction
    ALLOW_SYSCALL(__NR_rt_sigaction),
#endif
#ifdef __NR_rt_sigprocmask
    ALLOW_SYSCALL(__NR_rt_sigprocmask),
#endif
#ifdef __NR_futex
    ALLOW_SYSCALL(__NR_futex),
#endif
#ifdef __NR_exit
    ALLOW_SYSCALL(__NR_exit),
#endif
#ifdef __NR_exit_group
    ALLOW_SYSCALL(__NR_exit_group),
#endif
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
  };
  struct sock_fprog program = { .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])), .filter = filter };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return -1;
  return prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program);
}

static int mode_allowed(void) {
  char buffer[128] = {0};
  int input = open("/input/data.txt", O_RDONLY);
  if (input < 0) return 10;
  ssize_t count = read(input, buffer, sizeof(buffer) - 1);
  close(input);
  if (count <= 0) return 11;
  int output = open("/output/result.txt", O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (output < 0) return 12;
  dprintf(output, "bounded:%zd:%s", count, buffer);
  close(output);
  puts("allowed:pass");
  return 0;
}

static int main_mode(const char *mode) {
  if (strcmp(mode, "allowed") == 0) return mode_allowed();
  if (strcmp(mode, "network") == 0) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd == -1 && errno == EPERM) { puts("network:blocked"); return 0; }
    if (fd >= 0) close(fd);
    return 20;
  }
  if (strcmp(mode, "process") == 0) {
    pid_t pid = fork();
    if (pid == -1 && errno == EPERM) { puts("process:blocked"); return 0; }
    if (pid == 0) _exit(0);
    if (pid > 0) waitpid(pid, NULL, 0);
    return 21;
  }
  if (strcmp(mode, "hostfile") == 0) {
    int fd = open("/etc/passwd", O_RDONLY);
    if (fd == -1 && errno == ENOENT) { puts("hostfile:hidden"); return 0; }
    if (fd >= 0) close(fd);
    return 22;
  }
  if (strcmp(mode, "memory") == 0) {
    void *memory = malloc(128 * 1024 * 1024);
    if (memory == NULL) { puts("memory:blocked"); return 0; }
    free(memory); return 23;
  }
  if (strcmp(mode, "disk") == 0) {
    signal(SIGXFSZ, SIG_IGN);
    int fd = open("/output/oversized.bin", O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) return 24;
    char block[8192]; memset(block, 'x', sizeof(block));
    ssize_t result = write(fd, block, sizeof(block)); close(fd);
    if ((result < 0 && errno == EFBIG) || (result >= 0 && result < (ssize_t)sizeof(block))) { puts("disk:blocked"); return 0; }
    return 25;
  }
  if (strcmp(mode, "ptrace") == 0) {
    long result = syscall(SYS_ptrace, 0, 0, 0, 0);
    if (result == -1 && errno == EPERM) { puts("ptrace:blocked"); return 0; }
    return 26;
  }
  if (strcmp(mode, "exec") == 0) {
    char *const args[] = { "/probe", "allowed", NULL };
    execve("/probe", args, NULL);
    if (errno == EPERM) { puts("exec:blocked"); return 0; }
    return 27;
  }
  if (strcmp(mode, "uname") == 0) {
    struct utsname info;
    if (uname(&info) == -1 && errno == EPERM) { puts("uname:blocked"); return 0; }
    return 28;
  }
  return 99;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  if (install_limits() != 0) { perror("setrlimit"); return 3; }
  if (install_seccomp() != 0) { perror("seccomp"); return 4; }
  return main_mode(argv[1]);
}
