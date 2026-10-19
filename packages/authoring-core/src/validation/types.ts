import type { Project, StoryNode, Choice, Variable, Achievement } from '../model'

export type ValidationSeverity = 'error' | 'warning'

export interface ValidationIssue {
  ruleId: string
  severity: ValidationSeverity
  message: string
  messageParams?: Record<string, unknown>
  nodeId?: string
  choiceId?: string
  segmentIndex?: number
}

export interface ValidationContext {
  project: Project
  nodes: StoryNode[]
  choices: Choice[]
  variables: Variable[]
  achievements: Achievement[]
  isCommunityNode: (nodeId: string) => boolean
  isCommunityChoice: (choiceId: string) => boolean
}

export interface ValidationRule {
  id: string
  check(ctx: ValidationContext): ValidationIssue[]
}
