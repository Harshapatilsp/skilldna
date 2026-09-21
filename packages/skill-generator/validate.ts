import { parseDocument } from 'yaml';
import type { Draft, Validation } from '../domain';
import { redact } from '../privacy';
import { sections } from './index';
export const validName = (name: string) =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64;
export const safeRelative = (path: string) =>
  path.length < 200 &&
  !path.includes('\\') &&
  !path.includes(':') &&
  !path.startsWith('/') &&
  path
    .split('/')
    .every(
      (part) =>
        /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) &&
        !part.endsWith('.') &&
        !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
    );
export function validate(draft: Pick<Draft, 'name' | 'files'>): Validation {
  const result: Validation = { errors: [], warnings: [], recommendations: [] };
  if (!validName(draft.name) || !safeRelative(draft.name))
    result.errors.push(
      'Invalid skill directory name. Use lowercase words separated by hyphens, at most 64 characters.',
    );
  const markdown = draft.files['SKILL.md'];
  if (!markdown) {
    result.errors.push('SKILL.md is required.');
    return result;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) result.errors.push('Missing YAML frontmatter.');
  else {
    try {
      const document = parseDocument(match[1], { uniqueKeys: true });
      if (document.errors.length) throw new Error();
      const data = document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
      if (
        !data ||
        typeof data.name !== 'string' ||
        data.name !== draft.name ||
        !validName(data.name)
      )
        result.errors.push('Frontmatter name must match the valid directory name.');
      if (!data || typeof data.description !== 'string' || !data.description.trim())
        result.errors.push('Frontmatter description is required.');
      else if (
        !/use when|when /i.test(data.description) ||
        !/do not|not for/i.test(data.description)
      )
        result.warnings.push('Description should explain invocation context and exclusions.');
    } catch {
      result.errors.push('Invalid YAML frontmatter.');
    }
  }
  for (const [path, content] of Object.entries(draft.files)) {
    if (!safeRelative(path)) result.errors.push('Unsafe supporting file path.');
    const findings = redact(content).categories;
    if (
      findings.some((category) =>
        ['secret', 'token', 'private-key', 'connection-string'].includes(category),
      )
    )
      result.errors.push(`${path}: possible secret detected.`);
    if (findings.some((category) => ['identifier', 'email'].includes(category)))
      result.errors.push(`${path}: possible personal or customer identifier detected.`);
    if (findings.includes('path') || /(?:^|[\s("'])\/(?!\/)[A-Za-z0-9_.-]+\//m.test(content))
      result.errors.push(`${path}: absolute local path detected.`);
    if (path.startsWith('scripts/'))
      result.warnings.push(
        'Executable supporting file requires separate review. SkillDNA never runs it.',
      );
    for (const reference of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = reference[1].split('#')[0];
      if (!target && reference[1].startsWith('#')) continue;
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
      if (!safeRelative(target) || !(parent + target in draft.files))
        result.errors.push(`${path}: broken or unsafe file reference.`);
    }
  }
  for (const section of sections)
    if (!markdown.includes(`## ${section}`)) result.warnings.push(`Missing section: ${section}.`);
  if (!/\n1\. /m.test(markdown))
    result.warnings.push('Workflow should contain numbered actionable instructions.');
  if (!/human (approval|review)/i.test(markdown))
    result.warnings.push('Human-review requirements are missing.');
  if (!/synthetic example/i.test(markdown))
    result.warnings.push('Examples must be clearly synthetic.');
  if (
    /read all copilot|global copilot history|automatically send|automatically execute/i.test(
      markdown,
    )
  )
    result.warnings.push('Potential unsupported capability or unsafe automation assumption.');
  result.recommendations.push(
    'Review every file for unrecognized identifiers and unsupported tool assumptions. Automated checks cannot prove anonymity or correctness.',
  );
  return result;
}
