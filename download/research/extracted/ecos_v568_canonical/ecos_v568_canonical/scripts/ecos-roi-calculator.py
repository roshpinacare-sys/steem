#!/usr/bin/env python3
"""
ECOS B2B Economic Feasibility & ROI Calculator
----------------------------------------------
Provides rigorous mathematical proof of financial savings of the ECOS Autonomous
Flywheel (EAF) on-premises deployment compared to manual HITL validation.

Formula:
  - Human validation cost: $0.50 per transaction (average labor cost)
  - On-Premises GPU Server purchase cost (NVIDIA RTX 4090 24GB): $5,000
  - Hosting & Electricity cost: $150 / month
  - Local inference cost: $0.003 per transaction (hardware wear + power)
"""

import sys

def calculate_roi(monthly_transactions, self_healing_rate=0.82):
    # Variables
    server_cost = 5000.00
    monthly_hosting = 150.00
    human_cost_per_tx = 0.50
    local_inference_cost_per_tx = 0.003
    
    # Yearly volume
    yearly_transactions = monthly_transactions * 12
    
    # BASELINE: 100% human validation cost (before self-healing upgrades)
    yearly_human_baseline = yearly_transactions * human_cost_per_tx
    
    # EAF UPGRADE: self_healing_rate resolves tasks autonomously
    healed_yearly = yearly_transactions * self_healing_rate
    remaining_human_yearly = yearly_transactions * (1.0 - self_healing_rate)
    
    yearly_local_inf_cost = yearly_transactions * local_inference_cost_per_tx
    yearly_remaining_human_cost = remaining_human_yearly * human_cost_per_tx
    
    # Year 1 Costs (includes GPU server hardware purchase)
    year_1_eaf_cost = server_cost + (monthly_hosting * 12) + yearly_local_inf_cost + yearly_remaining_human_cost
    year_1_savings = yearly_human_baseline - year_1_eaf_cost
    
    # Year 2+ Costs (hardware fully depreciated, only hosting + power + remaining human)
    year_2_eaf_cost = (monthly_hosting * 12) + yearly_local_inf_cost + yearly_remaining_human_cost
    year_2_savings = yearly_human_baseline - year_2_eaf_cost
    
    # 5 Year projections
    total_savings_5_years = year_1_savings + (year_2_savings * 4)
    total_investment_5_years = server_cost + (monthly_hosting * 12 * 5)
    roi_5_years = (total_savings_5_years / total_investment_5_years) * 100
    
    print("==================================================================")
    print("           ECOS B2B AUTONOMOUS FLYWHEEL - FINANCIAL ROI MODEL       ")
    print("==================================================================")
    print(f"Inputs:")
    print(f"  Monthly Transaction Volume:      {monthly_transactions:,} transactions")
    print(f"  Yearly Transaction Volume:       {yearly_transactions:,} transactions")
    print(f"  Autonomous Self-Healing Rate:    {self_healing_rate * 100:.1f}%")
    print(f"  On-Premise GPU Server Cost:     $5,000.00 (RTX 4090 24GB VRAM)")
    print(f"  Server Monthly Operating Cost:   $150.00 (Hosting + Electricity)")
    print("------------------------------------------------------------------")
    print(f"Year 1 Financial Breakdown:")
    print(f"  Human Validation Baseline:       ${yearly_human_baseline:,.2f}")
    print(f"  ECOS EAF Active Operations:      ${year_1_eaf_cost:,.2f}  (Includes hardware purchase)")
    print(f"  NET YEAR 1 SAVINGS:              ${year_1_savings:,.2f}")
    print("------------------------------------------------------------------")
    print(f"Year 2+ Annualized Breakdown:")
    print(f"  Human Validation Baseline:       ${yearly_human_baseline:,.2f}")
    print(f"  ECOS EAF Active Operations:      ${year_2_eaf_cost:,.2f}")
    print(f"  NET ANNUAL SAVINGS:              ${year_2_savings:,.2f}")
    print("------------------------------------------------------------------")
    print(f"5-Year Long-Term Financial Impact:")
    print(f"  Total Cost of Ownership (TCO):   ${total_investment_5_years + (yearly_transactions * 5 * local_inference_cost_per_tx) + (remaining_human_yearly * 5 * human_cost_per_tx):,.2f}")
    print(f"  Total Human Baseline:            ${yearly_human_baseline * 5:,.2f}")
    print(f"  TOTAL ACCUMULATED SAVINGS:       ${total_savings_5_years:,.2f}")
    print(f"  System ROI (Return on Inv):      {roi_5_years:.2f}%")
    
    payback_months = (server_cost) / (year_2_savings / 12)
    print(f"  Server Payback Period:           {payback_months:.1f} months")
    print("==================================================================")

if __name__ == '__main__':
    volume = 25000 # Default production volume
    if len(sys.argv) > 1:
        try:
            volume = int(sys.argv[1])
        except ValueError:
            print("Usage: python3 ecos-roi-calculator.py [monthly_volume]")
            sys.exit(1)
            
    calculate_roi(volume)
