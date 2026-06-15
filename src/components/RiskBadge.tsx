import type { RiskGrade } from '../types/tm';export default function RiskBadge({grade}:{grade:RiskGrade}){return <span className={`risk-badge grade-${grade}`}>{grade}</span>}
