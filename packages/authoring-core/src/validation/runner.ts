import type { Project, StoryNode, Choice, Variable, Achievement } from '../model'
import type { ValidationContext, ValidationIssue } from './types'
import { ALL_RULES } from './rules'

export function buildValidationContext(
  project: Project,
  nodes: StoryNode[],
  choices: Choice[],
  variables: Variable[],
  achievements: Achievement[],
): ValidationContext {
  const communityNodeIds = new Set(
    nodes.filter(n => !!n.contributor_id).map(n => n.id),
  )
  const communityChoiceIds = new Set(
    choices.filter(c => communityNodeIds.has(c.node_id)).map(c => c.id),
  )
  const isCommunityNode = (nodeId: string) => communityNodeIds.has(nodeId)
  const isCommunityChoice = (choiceId: string) => communityChoiceIds.has(choiceId)
  return {
    project,
    nodes,
    choices,
    variables,
    achievements,
    isCommunityNode,
    isCommunityChoice,
  }
}

export function runValidation(ctx: ValidationContext): ValidationIssue[] {
  return ALL_RULES.flatMap(r => r.check(ctx))
}
