import { ClassificationRule } from "../models/finance.models";

/**
 * Analisa a descrição e retorna TODAS as regras correspondentes.
 */
export function classifyDescription(description: string, rules: ClassificationRule[]): ClassificationRule[] {
  if (!description || !rules || rules.length === 0) return [];

  const descNormalized = description.toUpperCase();

  // Retorna todas as regras que derem match
  return rules.filter(rule => {
    return rule.keywords.some(keyword => 
      descNormalized.includes(keyword.toUpperCase())
    );
  });
}