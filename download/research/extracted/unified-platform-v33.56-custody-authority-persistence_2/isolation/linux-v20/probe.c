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
#include <sys/wait.h>
#include <unistd.h>

#define DENY_SYSCALL(nr) \
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (nr), 0, 1), \
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA))

static int install_limits(void) {
  struct rlimit limit;
  limit.rlim_cur = limit.rlim_max = 1; if (setrlimit(RLIMIT_CPU, &limit) != 0) return -1;
  limit.rlim_cur = limit.rlim_max = 32 * 1024 * 1024; if (setrlimit(RLIMIT_AS, &limit) != 0) return -1;
  limit.rlim_cur = limit.rlim_max = 4096; if (setrlimit(RLIMIT_FSIZE, &limit) != 0) return -1;
  limit.rlim_cur = limit.rlim_max = 1; if (setrlimit(RLIMIT_NPROC, &limit) != 0) return -1;
  limit.rlim_cur = limit.rlim_max = 16; if (setrlimit(RLIMIT_NOFILE, &limit) != 0) return -1;
  return 0;
}

static int install_seccomp(void) {
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#ifdef __NR_socket
    DENY_SYSCALL(__NR_socket),
#endif
#ifdef __NR_socketpair
    DENY_SYSCALL(__NR_socketpair),
#endif
#ifdef __NR_connect
    DENY_SYSCALL(__NR_connect),
#endif
#ifdef __NR_accept
    DENY_SYSCALL(__NR_accept),
#endif
#ifdef __NR_accept4
    DENY_SYSCALL(__NR_accept4),
#endif
#ifdef __NR_bind
    DENY_SYSCALL(__NR_bind),
#endif
#ifdef __NR_listen
    DENY_SYSCALL(__NR_listen),
#endif
#ifdef __NR_clone
    DENY_SYSCALL(__NR_clone),
#endif
#ifdef __NR_clone3
    DENY_SYSCALL(__NR_clone3),
#endif
#ifdef __NR_fork
    DENY_SYSCALL(__NR_fork),
#endif
#ifdef __NR_vfork
    DENY_SYSCALL(__NR_vfork),
#endif
#ifdef __NR_ptrace
    DENY_SYSCALL(__NR_ptrace),
#endif
#ifdef __NR_mount
    DENY_SYSCALL(__NR_mount),
#endif
#ifdef __NR_umount2
    DENY_SYSCALL(__NR_umount2),
#endif
#ifdef __NR_bpf
    DENY_SYSCALL(__NR_bpf),
#endif
#ifdef __NR_perf_event_open
    DENY_SYSCALL(__NR_perf_event_open),
#endif
#ifdef __NR_keyctl
    DENY_SYSCALL(__NR_keyctl),
#endif
#ifdef __NR_add_key
    DENY_SYSCALL(__NR_add_key),
#endif
#ifdef __NR_request_key
    DENY_SYSCALL(__NR_request_key),
#endif
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
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
    free(memory);
    return 23;
  }
  if (strcmp(mode, "disk") == 0) {
    signal(SIGXFSZ, SIG_IGN);
    int fd = open("/output/oversized.bin", O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) return 24;
    char block[8192]; memset(block, 'x', sizeof(block));
    ssize_t result = write(fd, block, sizeof(block));
    close(fd);
    if ((result < 0 && errno == EFBIG) || (result >= 0 && result < (ssize_t)sizeof(block))) { puts("disk:blocked"); return 0; }
    return 25;
  }
  if (strcmp(mode, "ptrace") == 0) {
    long result = syscall(SYS_ptrace, 0, 0, 0, 0);
    if (result == -1 && errno == EPERM) { puts("ptrace:blocked"); return 0; }
    return 26;
  }
  return 99;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  if (install_limits() != 0) { perror("setrlimit"); return 3; }
  if (install_seccomp() != 0) { perror("seccomp"); return 4; }
  return main_mode(argv[1]);
}
