# Rootless container candidate

Required runtime properties:

- rootless user namespace;
- read-only root filesystem;
- no-new-privileges;
- all Linux capabilities dropped;
- seccomp allowlist;
- no host PID, IPC, network or mount namespace;
- explicit read-only input mount;
- explicit output-only mount;
- CPU, memory, process, file-size and file-descriptor limits;
- no Docker socket;
- signed, digest-pinned image;
- empty secret environment unless explicitly brokered.

Docker and Podman are not installed in the current environment, so this candidate remains `BLOCKED_ENVIRONMENT`.
