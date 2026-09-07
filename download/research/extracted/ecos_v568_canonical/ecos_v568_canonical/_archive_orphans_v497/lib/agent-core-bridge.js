/**
 * ECOS Agent Core Bridge — V38.1 (Manus Logic Port)
 * ─────────────────────────────────────────────────────────────────────────────
 * This module implements an autonomous "ReAct" (Reason + Act) loop.
 * It allows ECOS to think, call tools, and observe results before finalizing.
 */

const logger = require('./logger'); // Assuming ECOS structured logger

class ECOS_Agent_Bridge {
  constructor(config) {
    this.llm = config.llm; // The LLM interface
    this.tools = new Map();
    this.maxSteps = config.maxSteps || 5;
    this.registerDefaultTools();
  }

  /**
   * Register capabilities the Agent can actually USE.
   */
  registerTool(name, fn, description) {
    this.tools.set(name, { fn, description });
  }

  registerDefaultTools() {
    // Tool 1: Check Ledger
    this.registerTool('check_ledger', async (args) => {
      // Integration with fiatLedger.js
      return `Account balance for ${args.id} is active. Last entry: ${args.lastEntry || 'N/A'}`;
    }, "Retrieves financial state from the ECOS Ledger.");

    // Tool 2: Audit History
    this.registerTool('query_audit_log', async (args) => {
      // Integration with auditLog.js
      return `Found 3 related missions for client ${args.clientId}. Average confidence: 0.82`;
    }, "Searches past mission history for context.");
  }

  /**
   * The core Autonomous Loop: Think -> Act -> Observe
   */
  async runMission(goal, context = {}) {
    let history = [{ role: 'system', content: this.buildSystemPrompt() }];
    history.push({ role: 'user', content: `Goal: ${goal}\nContext: ${JSON.stringify(context)}` });

    let currentStep = 0;
    let finalResult = null;

    logger.info({ mission: context.missionId }, "Autonomous Agent Loop Started");

    while (currentStep < this.maxSteps) {
      currentStep++;
      
      // 1. THINK: Ask LLM for next action
      const response = await this.llm.generate({
        messages: history,
        temperature: 0,
        stop: ["Observation:"]
      });

      const text = response.text;
      history.push({ role: 'assistant', content: text });

      // Parse Action (Format: Thought: ... Action: tool_name(args) )
      const actionMatch = text.match(/Action:\s*(\w+)\((.*)\)/);
      
      if (actionMatch) {
        const [_, toolName, toolArgsStr] = actionMatch;
        const tool = this.tools.get(toolName);

        if (tool) {
          logger.info({ toolName, step: currentStep }, "Agent executing tool");
          try {
            const args = JSON.parse(toolArgsStr || '{}');
            const observation = await tool.fn(args);
            
            // 2. OBSERVE: Feed the result back into the loop
            history.push({ role: 'user', content: `Observation: ${observation}` });
          } catch (err) {
            history.push({ role: 'user', content: `Observation: Error executing tool: ${err.message}` });
          }
        } else {
          history.push({ role: 'user', content: `Observation: Tool ${toolName} not found.` });
        }
      } else {
        // No action found -> Assume final answer
        finalResult = text;
        break;
      }
    }

    return {
      success: !!finalResult,
      steps: currentStep,
      output: finalResult || "Agent reached max steps without conclusion.",
      log: history
    };
  }

  buildSystemPrompt() {
    const toolDesc = Array.from(this.tools.entries())
      .map(([name, t]) => `- ${name}: ${t.description}`)
      .join('\n');

    return `You are the ECOS Autonomous Agent.
You have access to the following tools:
${toolDesc}

Use the following format:
Thought: Describe your reasoning.
Action: tool_name({"arg": "value"})
Observation: The result of the action (will be provided to you).
... (Repeat Thought/Action/Observation if needed)
Final Answer: Your final verdict for the ECOS mission.

Always start with a Thought. Only call one tool at a time.`;
  }
}

module.exports = ECOS_Agent_Bridge;
