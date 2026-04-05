/**
 * Token usage tracker — accumulates token counts across OpenAI API calls
 * and prints a summary with estimated cost.
 */

// GPT-4.1-mini pricing per million tokens
const INPUT_COST_PER_M = 0.40
const OUTPUT_COST_PER_M = 1.60

interface CallRecord {
  label: string
  inputTokens: number
  outputTokens: number
}

class TokenTracker {
  private calls: CallRecord[] = []

  track(label: string, usage: { input_tokens: number; output_tokens: number }) {
    this.calls.push({
      label,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    })
  }

  get totalInput(): number {
    return this.calls.reduce((sum, c) => sum + c.inputTokens, 0)
  }

  get totalOutput(): number {
    return this.calls.reduce((sum, c) => sum + c.outputTokens, 0)
  }

  get totalTokens(): number {
    return this.totalInput + this.totalOutput
  }

  get estimatedCost(): number {
    return (this.totalInput / 1_000_000) * INPUT_COST_PER_M +
           (this.totalOutput / 1_000_000) * OUTPUT_COST_PER_M
  }

  printSummary() {
    console.log('\n── Token Usage ──────────────────────────────────')
    for (const call of this.calls) {
      const total = call.inputTokens + call.outputTokens
      console.log(`  ${call.label.padEnd(28)} ${total.toLocaleString().padStart(8)} tokens  (in: ${call.inputTokens.toLocaleString()}, out: ${call.outputTokens.toLocaleString()})`)
    }
    console.log('  ──────────────────────────────────────────────')
    console.log(`  ${'Total'.padEnd(28)} ${this.totalTokens.toLocaleString().padStart(8)} tokens  (in: ${this.totalInput.toLocaleString()}, out: ${this.totalOutput.toLocaleString()})`)
    console.log(`  ${'Estimated cost'.padEnd(28)} ${('$' + this.estimatedCost.toFixed(4)).padStart(8)}`)
    console.log('─────────────────────────────────────────────────\n')
  }

  get callHistory() {
    return [...this.calls]
  }

  reset() {
    this.calls = []
  }
}

export const tokenTracker = new TokenTracker()
