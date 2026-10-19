import type { ValidationRule } from '../types'
import { aiReplaceMissingPaidEntryRule } from './aiReplaceMissingPaidEntry'
import { aiReplaceSegmentMissingVideoRule } from './aiReplaceSegmentMissingVideo'
import { aiReplaceSegmentMissingMaskRule } from './aiReplaceSegmentMissingMask'
import { aiReplaceSegmentMissingCostRule } from './aiReplaceSegmentMissingCost'
import { aiReplaceChoiceMissingPaidVarRule } from './aiReplaceChoiceMissingPaidVar'
import { aiReplacePaidVarNotFoundRule } from './aiReplacePaidVarNotFound'
import { aiReplaceChoiceEffectsMissingTrueRule } from './aiReplaceChoiceEffectsMissingTrue'
import { aiReplaceTargetReachedByNonAiChoiceRule } from './aiReplaceTargetReachedByNonAiChoice'
import { projectMissingStartNodeRule } from './projectMissingStartNode'
import { choiceMissingLabelRule } from './choiceMissingLabel'
import { choiceMissingTargetRule } from './choiceMissingTarget'
import { choiceInteractionInvalidRule } from './choiceInteractionInvalid'
import { hotspotRegionsInsufficientRule } from './hotspotRegionsInsufficient'
import { choicePresentationInvalidRule } from './choicePresentationInvalid'

export const ALL_RULES: ValidationRule[] = [
  projectMissingStartNodeRule,
  choiceMissingLabelRule,
  choiceMissingTargetRule,
  choiceInteractionInvalidRule,
  hotspotRegionsInsufficientRule,
  choicePresentationInvalidRule,
  aiReplaceMissingPaidEntryRule,
  aiReplaceSegmentMissingVideoRule,
  aiReplaceSegmentMissingMaskRule,
  aiReplaceSegmentMissingCostRule,
  aiReplaceChoiceMissingPaidVarRule,
  aiReplacePaidVarNotFoundRule,
  aiReplaceChoiceEffectsMissingTrueRule,
  aiReplaceTargetReachedByNonAiChoiceRule,
]
