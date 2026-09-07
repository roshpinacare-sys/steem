# WebAssembly Core isolation proof

This is an executable intermediate isolation candidate. It is not the WASI Component Model and is not production-qualified.

Proved locally:

- import allowlisting;
- no ambient filesystem, network, process or environment imports;
- explicit host capability adapters;
- fixed maximum linear memory;
- termination of an infinite loop by running the module in a host Worker.

Not yet proved:

- Component Model interface composition;
- WASI filesystem adapters;
- epoch/fuel interruption inside a dedicated runtime;
- cryptographic module signing and publisher identity;
- side-channel resistance;
- resource accounting across many modules;
- native host-adapter security;
- production operational isolation.
