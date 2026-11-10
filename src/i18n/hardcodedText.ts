/**
 * Finds user-facing text that is hard-coded in a screen instead of coming
 * from `t()`: JSX text, string props such as `title=` / `placeholder=`, and
 * the title/message of `Alert.alert(...)`. Used by i18n.screens.test.ts to
 * keep the Telugu-first screens free of English-only text and errors.
 *
 * Node-only (uses the TypeScript compiler) — never import it from app code.
 */
import * as ts from 'typescript';

/** Props whose string value is shown to the user. */
const TEXT_PROPS = new Set([
  'title', 'label', 'placeholder', 'message', 'subtitle', 'description', 'hint',
  'emptyText', 'accessibilityLabel', 'helperText', 'error', 'confirmText', 'cancelText',
]);

/** Words that are the same in every language the app ships (brands, units, formats). */
const ALLOWED = /^(?:₹|GST|GSTIN|UPI|UTR|PDF|Excel|CSV|SMS|WhatsApp|OTP|AI|ID|OK|Bolcash|Smart CashBook|Tally|CA|HSN|SKU|IST|English|Hinglish|తెలుగు)$/;

export interface Finding {
  line: number;
  text: string;
}

/** Tailwind class lists ("text-sm font-bold") are styling, not text. */
const CLASS_LIST = /^\s*[a-z0-9:/[\]%.#-]+(?:\s+[a-z0-9:/[\]%.#-]+)*\s*$/;

export function hasWords(text: string): boolean {
  if (CLASS_LIST.test(text) && /-/.test(text)) return false;
  // Codes with digits (a GSTIN example like 29ABCDE1234F1Z5) aren't words.
  const words = text.replace(/\S*\d\S*/g, ' ').match(/[A-Za-z][A-Za-z'’]+/g) ?? [];
  return words.some(w => !ALLOWED.test(w));
}

export function findHardcodedText(source: string, fileName = 'x.tsx'): Finding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Finding[] = [];
  const add = (node: ts.Node, text: string) => {
    if (hasWords(text)) {
      out.push({line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: text.trim()});
    }
  };
  const literalText = (e: ts.Expression | undefined): string | null => {
    if (!e) return null;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) {
      return [e.head.text, ...e.templateSpans.map(s => s.literal.text)].join(' ');
    }
    if (ts.isConditionalExpression(e)) {
      return [literalText(e.whenTrue), literalText(e.whenFalse)].filter(Boolean).join(' ') || null;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return literalText(e.right);
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return literalText(e.right);
    }
    if (ts.isParenthesizedExpression(e)) return literalText(e.expression);
    return null;
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      add(node, node.text);
    } else if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const text = literalText(node.expression);
      if (text) add(node, text);
    } else if (ts.isJsxAttribute(node) && TEXT_PROPS.has(node.name.getText())) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(node, init.text);
      else if (init && ts.isJsxExpression(init)) {
        const text = literalText(init.expression);
        if (text) add(node, text);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.getText() === 'Alert.alert'
    ) {
      for (const arg of node.arguments.slice(0, 2)) {
        const text = literalText(arg);
        if (text) add(arg, text);
      }
      const buttons = node.arguments[2];
      if (buttons && ts.isArrayLiteralExpression(buttons)) {
        for (const b of buttons.elements) {
          if (!ts.isObjectLiteralExpression(b)) continue;
          for (const p of b.properties) {
            if (ts.isPropertyAssignment(p) && p.name.getText() === 'text') {
              const text = literalText(p.initializer);
              if (text) add(p, text);
            }
          }
        }
      }
    } else if (
      ts.isPropertyAssignment(node) &&
      TEXT_PROPS.has(node.name.getText().replace(/['"]/g, '')) &&
      !ts.isCallExpression(node.parent.parent ?? node) // Alert buttons handled above
    ) {
      const text = literalText(node.initializer);
      if (text) add(node, text);
    } else if (ts.isNewExpression(node) && node.expression.getText() === 'Error') {
      const text = literalText(node.arguments?.[0]);
      if (text) add(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
