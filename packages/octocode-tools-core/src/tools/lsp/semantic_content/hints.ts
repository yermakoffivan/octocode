import type {
  HintContext,
  ToolHintGenerators,
} from '../../../types/metadata.js';
import type { SemanticContentType } from '../shared/semanticTypes.js';

export const hints: ToolHintGenerators = {
  empty: (ctx: HintContext = {}) => {
    const symbolName = typeof ctx.symbolName === 'string' ? ctx.symbolName : '';
    const hintContext = ctx as Record<string, unknown>;
    const semanticType =
      typeof hintContext.type === 'string'
        ? (hintContext.type as SemanticContentType)
        : undefined;
    if (!symbolName && !semanticType) return [];
    if (semanticType === 'documentSymbols') {
      return ['Verify uri with localFindFiles/localSearchCode, then retry.'];
    }
    if (semanticType === 'references') {
      return [
        'references is a single request scoped to the anchor file TS program (package tsconfig); a declaration-only result is a false dead-code signal.',
        'For reachability use type="callers" on functions/methods (cross-package, decisive); callers returns noCalls on non-callables — corroborate with localSearchCode(symbolName).',
      ];
    }

    return [
      'Re-anchor with localSearchCode to get uri+symbolName+lineHint; use documentSymbols if the symbol is ambiguous.',
    ];
  },
  error: (ctx: HintContext = {}) => {
    if (ctx.errorType === 'lsp_unavailable') {
      return [
        'Language server unavailable — use localSearchCode for references and localGetFileContent for source slices.',
      ];
    }
    if (ctx.errorType === 'symbol_not_found') {
      return [
        'Run localSearchCode for the exact symbol line, then retry with updated uri+lineHint.',
      ];
    }
    return [];
  },
};

export function semanticHints(
  type: SemanticContentType,
  complete: boolean
): string[] {
  if (complete) {
    const success: Partial<Record<SemanticContentType, string[]>> = {
      documentSymbols: [
        'Use returned line values as lineHint for definition, references, or callers.',
      ],
      hover: [
        'type="definition" to jump to source, type="callers" for cross-package usage.',
      ],
      definition: [
        'localGetFileContent for context; type="callers" for callable impact, localSearchCode(symbolName) for non-callable usages.',
      ],
      typeDefinition: [
        'localGetFileContent for the type, type="implementation" for concrete implementations.',
      ],
      implementation: [
        'localGetFileContent for implementation, type="callers" for call sites.',
      ],
      references: [
        'groupByFile=true for compact summary, localGetFileContent for context.',
        'Scoped to the anchor file TS program; can miss usages. Use callers for functions/methods; corroborate non-callables with localSearchCode(symbolName) before treating as unused.',
      ],
      callers: [
        'Increase depth for a wider tree, localGetFileContent for context.',
      ],
      callees: [
        'Increase depth, type="definition" on returned calls for source.',
      ],
      callHierarchy: [
        'Increase depth, localGetFileContent on call sites for context.',
      ],
    };
    return [...(success[type] ?? [])];
  }

  const notFound: Partial<Record<SemanticContentType, string[]>> = {
    definition: ['Re-anchor with localSearchCode and retry.'],
    hover: ['Try type="definition" instead.'],
    typeDefinition: ['Try type="hover" for the inferred type.'],
    references: [
      'references is a single request scoped to the anchor file TS program (package tsconfig); a declaration-only result is a false dead-code signal.',
      'For reachability use type="callers" on functions/methods (cross-package, decisive); callers returns noCalls on non-callables — corroborate with localSearchCode(symbolName).',
    ],
    callers: [
      'callHierarchyProvider unsupported (e.g. Python, C++). Fall back to localSearchCode(symbolName); references is incomplete — use only as a hint.',
      'Use localSearchCode for dynamic references.',
    ],
    callees: [
      'callHierarchyProvider unsupported (e.g. Python, C++). Use localSearchCode(symbolName) for a usage sweep; references is an incomplete hint.',
      'Use localSearchCode for dynamic calls.',
    ],
    callHierarchy: [
      'callHierarchyProvider unsupported (e.g. Python, C++). Fall back to localSearchCode(symbolName); references is incomplete — use only as a hint.',
      'Use localSearchCode for dynamic references.',
    ],
    documentSymbols: [
      'Use localSearchCode with "export|function|class|const" as a fallback.',
    ],
    implementation: [
      'symbolName must be a method/property of an interface or abstract class — not the class name.',
      'Use type="documentSymbols" to list members, then retry with a member name.',
    ],
  };

  return [...(notFound[type] ?? [])];
}
