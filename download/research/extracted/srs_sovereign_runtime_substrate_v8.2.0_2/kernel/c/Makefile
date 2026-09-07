CC      = gcc
CFLAGS  = -Wall -Wextra -std=c11 -g
LDLIBS  = -lm
OBJS    = smpu.o qos.o sched.o

all: omnivisor_sim tests

omnivisor_sim: main.o $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDLIBS)

tests: tests.o $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDLIBS)

%.o: %.c
	$(CC) $(CFLAGS) -c $<

run: omnivisor_sim
	./omnivisor_sim

check: tests
	./tests

clean:
	rm -f *.o omnivisor_sim tests

.PHONY: all run check clean
