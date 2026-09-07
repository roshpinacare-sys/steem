__attribute__((export_name("run")))
int run(void) {
  volatile int counter = 0;
  for (;;) counter++;
  return counter;
}
