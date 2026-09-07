------------------------------- MODULE TemporalBankerSchedulerCfg -------------------------------
(* Constant definitions for TLC model-checking.
   This module provides the concrete values for the CONSTANTS in
   TemporalBankerScheduler. *)

EXTENDS Naturals

DomainsVal == {"APU", "RPU", "FPGA"}
RefillRateVal == [APU |-> 2, RPU |-> 1, FPGA |-> 1]
HyperCallsVal == 1..10
MaxBudgetVal == 5
EpochLimitVal == 20

=============================================================================
