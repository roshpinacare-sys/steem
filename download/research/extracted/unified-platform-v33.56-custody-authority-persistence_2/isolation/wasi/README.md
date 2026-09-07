# WASI candidate

The WIT world grants only repository reads and evidence emission. It deliberately exports no arbitrary filesystem, socket, process, secret, clock, or environment interface.

The required attack suite includes:

- host filesystem read;
- output path escape;
- network egress;
- process creation;
- environment/secret access;
- excessive CPU, memory, output and file-descriptor use;
- native extension loading;
- confused-deputy access through the host adapter;
- capability revocation while running.

No WASI runtime is installed in the current environment, so this candidate remains `BLOCKED_ENVIRONMENT`.
