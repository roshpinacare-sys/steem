__attribute__((import_module("cap"), import_name("read_byte")))
extern int read_byte(int index);
__attribute__((import_module("cap"), import_name("emit")))
extern int emit(int value);
__attribute__((export_name("run")))
int run(int count) {
  int sum = 0;
  for (int i = 0; i < count; i++) sum += read_byte(i);
  emit(sum);
  return sum;
}
