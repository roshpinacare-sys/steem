__attribute__((import_module("env"), import_name("host_secret")))
extern int host_secret(void);
__attribute__((export_name("run")))
int run(void) { return host_secret(); }
