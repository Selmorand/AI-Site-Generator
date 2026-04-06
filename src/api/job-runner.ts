/**
 * Job runner — wraps mode functions, intercepts console.log,
 * and emits SSE events for the dashboard.
 */

import * as path from 'path'
import * as crypto from 'crypto'
import { generate } from '../modes/generate.js'
import { rebuild } from '../modes/rebuild.js'
import { clone } from '../modes/clone.js'
import { tokenTracker } from '../token-tracker.js'
import type { GenerateInput, CloneInput, RebuildInput, DesignTokens } from '../types/blueprint.js'

export interface JobEvent {
  type: 'progress' | 'token' | 'complete' | 'error'
  data: Record<string, unknown>
}

type EventCallback = (event: JobEvent) => void

let runningJobId: string | null = null

export function isJobRunning(): boolean {
  return runningJobId !== null
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}

export async function runJob(
  mode: string,
  params: Record<string, unknown>,
  onEvent: EventCallback
): Promise<string> {
  if (runningJobId) {
    throw new Error('A generation is already in progress')
  }

  // Generate job ID
  const nameSlug = slugify((params.name as string) || (params.url as string) || 'site')
  const jobId = `${nameSlug}-${Date.now()}`
  const outputDir = path.resolve('./output', jobId)
  runningJobId = jobId

  // Intercept console.log
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    originalLog(...args)
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    onEvent({ type: 'progress', data: { message } })
  }

  // Intercept tokenTracker.track
  const originalTrack = tokenTracker.track.bind(tokenTracker)
  tokenTracker.reset()
  tokenTracker.track = (label: string, usage: { input_tokens: number; output_tokens: number }) => {
    originalTrack(label, usage)
    onEvent({
      type: 'token',
      data: { label, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
    })
  }

  try {
    if (mode === 'generate') {
      const input: GenerateInput = {
        mode: 'generate',
        brief: params.brief as string,
        clientContent: {
          businessName: params.name as string,
          description: params.description as string,
          industry: params.industry as string | undefined,
          contactPhone: params.phone as string | undefined,
          contactEmail: params.email as string | undefined,
          address: params.address as string | undefined,
        },
        stylePreference: params.style as DesignTokens['style'] | undefined,
      }
      // Build design override if colours/fonts provided
      const designOverride = params.colors ? {
        colors: params.colors as DesignTokens['colors'],
        fonts: (params.fonts as DesignTokens['fonts']) || { heading: 'Inter', body: 'Open Sans' },
        borderRadius: '8px',
        style: (params.template as string) || 'modern',
      } as DesignTokens : undefined

      await generate(input, outputDir, {
        template: params.template as string | undefined,
        designOverride,
      })
    } else if (mode === 'rebuild') {
      const input: RebuildInput = {
        mode: 'rebuild',
        url: params.url as string,
        auditorApiKey: params.auditorKey as string | undefined,
      }
      await rebuild(input, outputDir)
    } else if (mode === 'clone') {
      const input: CloneInput = {
        mode: 'clone',
        inspirationUrl: params.inspirationUrl as string,
        clientContent: {
          businessName: params.name as string,
          description: params.description as string,
          industry: params.industry as string | undefined,
          contactPhone: params.phone as string | undefined,
          contactEmail: params.email as string | undefined,
          address: params.address as string | undefined,
        },
      }
      await clone(input, outputDir)
    } else {
      throw new Error(`Unknown mode: ${mode}`)
    }

    onEvent({
      type: 'complete',
      data: {
        jobId,
        previewUrl: `/preview/${jobId}/`,
        tokens: {
          totalInput: tokenTracker.totalInput,
          totalOutput: tokenTracker.totalOutput,
          totalTokens: tokenTracker.totalTokens,
          estimatedCost: tokenTracker.estimatedCost,
          calls: tokenTracker.callHistory,
        },
      },
    })
  } catch (err) {
    onEvent({
      type: 'error',
      data: { message: (err as Error).message },
    })
  } finally {
    console.log = originalLog
    tokenTracker.track = originalTrack
    runningJobId = null
  }

  return jobId
}
