/**
 * ECOS Self-Refinement Agent — V100
 * -----------------------------------
 * Two-pass LLM quality loop:
 *   Pass 1: execute the original task → aiOutput + confidence
 *   Pass 2: if confidence < REFINEMENT_THRESHOLD (0.65):
 *     Send aiOutput back to LLM for review/improvement
 *     Compare confidence scores, return the better result
 *
 * Also exposes the original healOutput() method for semantic patch healing.
 */

'use strict';

const offlineInference = require('./offlineInference');

// [FIX-BUG-F] Read REFINEMENT_THRESHOLD from env var (default 0.65, validated in config.js)
const REFINEMENT_THRESHOLD = (() => {
  const v = parseFloat(process.env.REFINEMENT_THRESHOLD || '0.65');
  return (isNaN(v) || v < 0.50 || v > 0.99) ? 0.65 : v;
})();

class SelfRefinementAgent {
  /**
   * 2-pass self-refinement loop.
   * @param {string} systemPrompt - Original system prompt
   * @param {string} userPrompt   - Original user task
   * @returns {{ aiOutput, confidence, pass: 1|2, refined: boolean }}
   */
  async refine(systemPrompt, userPrompt) {
    // Pass 1: execute original task
    const pass1 = await offlineInference.executeTask(systemPrompt, userPrompt);
    const conf1 = typeof pass1.confidence === 'number' ? pass1.confidence : 0;

    // If confidence is above threshold, skip refinement
    if (conf1 >= REFINEMENT_THRESHOLD) {
      return {
        aiOutput:   pass1.aiOutput,
        confidence: conf1,
        pass:       1,
        refined:    false,
      };
    }

    // Pass 2: ask LLM to review and improve
    const reviewSystemPrompt =
      'You are a quality reviewer. Review this output and improve it.\n' +
      `Original task: ${userPrompt}\n` +
      `First attempt: ${JSON.stringify(pass1.aiOutput)}\n` +
      'Improve for accuracy and completeness. Return same JSON schema.';

    const pass2 = await offlineInference.executeTask(reviewSystemPrompt, userPrompt);
    const conf2 = typeof pass2.confidence === 'number' ? pass2.confidence : 0;

    // Return whichever pass had higher confidence
    if (conf2 > conf1) {
      return {
        aiOutput:   pass2.aiOutput,
        confidence: conf2,
        pass:       2,
        refined:    true,
      };
    }

    return {
      aiOutput:   pass1.aiOutput,
      confidence: conf1,
      pass:       1,
      refined:    false,
    };
  }

  /**
   * Legacy heal method: apply a semantic knowledge patch onto an existing AI output.
   */
  async healOutput(taskType, originalOutput, patchBody, taskContext = {}) {
    const systemPrompt = `
You are the ECOS Internal Self-Healing Agent.
Your job is to apply a "Knowledge Patch" (which represents a gold-standard correction made by a human validator) onto a new, slightly faulty AI output.

Task Context: ${JSON.stringify(taskContext)}
Task Category: ${taskType}

Here is the Faulty AI Output:
${JSON.stringify(originalOutput)}

Here is the Gold-Standard Correction Pattern (Knowledge Patch):
${JSON.stringify(patchBody)}

Apply the logical correction pattern from the Knowledge Patch onto the Faulty AI Output.
Your response MUST be a single, valid JSON object matching the schema. Do not explain, do not write markdown.
`;

    const userPrompt = 'Apply the correction and return the optimized JSON output object now.';

    try {
      const { aiOutput, confidence } = await offlineInference.executeTask(systemPrompt, userPrompt);
      return {
        refinedOutput: aiOutput,
        confidence:    confidence ?? null,
        healed:        true,
      };
    } catch (err) {
      console.warn('[SelfRefinementAgent] Self-healing cycle degraded (returning baseline):', err.message);
      return {
        refinedOutput: originalOutput,
        confidence:    null,
        healed:        false,
      };
    }
  }
}

module.exports = new SelfRefinementAgent();
