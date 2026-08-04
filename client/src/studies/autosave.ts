import { AnalysisPoint, MoveRecord, StudyPosition, VariationTree } from '../types'

export interface StudyContentSnapshot {
  initialFen: string
  moves: MoveRecord[]
  currentMoveIndex: number
  analysisPoints: AnalysisPoint[]
  variationTree?: VariationTree
}

export function createStudyContentSignature(content: StudyContentSnapshot): string {
  return JSON.stringify(content)
}

export function createStudySaveInput(study: StudyPosition, content: StudyContentSnapshot) {
  return {
    id: study.id,
    name: study.name,
    description: study.description,
    ...content,
  }
}
