'use client';

import type { CatalogRow } from '@/lib/admin/catalog';

/** The editable shape. Numbers stay strings while typing; the server coerces them. */
export interface ScholarshipDraft {
  title: string;
  funder: string;
  country: string;
  amountCurrency: string;
  amountValue: string;
  amountType: string;
  deadline: string;
  degreeLevels: string[];
  fieldsOfStudy: string[];
  eligibleNationalities: string[];
  minGpa: string;
  requirements: string;
  eligibility: string[];
  description: string;
  sourceUrl: string;
  sourceType: string;
  requiredDocs: string[];
  benefits: string[];
}

export const AMOUNT_TYPES = ['full', 'partial', 'stipend', 'unknown'];
export const SOURCE_TYPES = ['university', 'funder', 'government'];

export const EMPTY_DRAFT: ScholarshipDraft = {
  title: '',
  funder: '',
  country: '',
  amountCurrency: 'USD',
  amountValue: '',
  amountType: 'unknown',
  deadline: '',
  degreeLevels: [],
  fieldsOfStudy: [],
  eligibleNationalities: [],
  minGpa: '',
  requirements: '',
  eligibility: [],
  description: '',
  sourceUrl: '',
  sourceType: '',
  requiredDocs: [],
  benefits: [],
};

export function draftFromRow(row: CatalogRow): ScholarshipDraft {
  const text = (value: number | null) => (value === null || value === undefined ? '' : String(value));
  return {
    title: row.title ?? '',
    funder: row.funder ?? '',
    country: row.country ?? '',
    amountCurrency: row.amount_currency ?? '',
    amountValue: text(row.amount_value),
    amountType: row.amount_type ?? 'unknown',
    deadline: row.deadline ?? '',
    degreeLevels: row.degree_levels ?? [],
    fieldsOfStudy: row.fields_of_study ?? [],
    eligibleNationalities: row.eligible_nationalities ?? [],
    minGpa: text(row.min_gpa),
    requirements: row.requirements ?? '',
    eligibility: row.eligibility ?? [],
    description: row.description ?? '',
    sourceUrl: row.source_url ?? '',
    sourceType: row.source_type ?? '',
    requiredDocs: row.required_docs ?? [],
    benefits: row.benefits ?? [],
  };
}

/** What the server will accept. Mirrors `checkFields`, minus the aggregator list. */
export function isPublishable(draft: ScholarshipDraft): boolean {
  return draft.title.trim() !== ''
    && draft.deadline !== ''
    && draft.sourceUrl.trim() !== ''
    && SOURCE_TYPES.includes(draft.sourceType);
}

interface ScholarshipFormProps {
  draft: ScholarshipDraft;
  onChange: (draft: ScholarshipDraft) => void;
  /** Draft keys to outline in amber — fields the AI was unsure about. */
  highlight?: string[];
}

/**
 * Every catalog field, editable. Shared by the manual-add modal and the catalog
 * editor so both surfaces offer the same columns in the same order as the review
 * card.
 */
export default function ScholarshipForm({ draft, onChange, highlight = [] }: ScholarshipFormProps) {
  const set = <K extends keyof ScholarshipDraft>(key: K, value: ScholarshipDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const fieldClass = (field: string) =>
    `input ${highlight.includes(field) ? 'border-[var(--amber)]' : ''}`;

  const label = (text: string) => (
    <label className="block text-xs font-bold text-tertiary uppercase tracking-wide mb-1.5">
      {text}
    </label>
  );

  const arrayField = (
    field: 'degreeLevels' | 'fieldsOfStudy' | 'eligibleNationalities' | 'eligibility'
      | 'requiredDocs' | 'benefits',
    text: string,
    rows = 2
  ) => (
    <div className="min-w-0">
      {label(`${text} (one per line)`)}
      <textarea
        value={draft[field].join('\n')}
        onChange={(e) => set(field, e.target.value.split('\n').filter(Boolean))}
        rows={rows}
        className={`${fieldClass(field)} resize-none text-sm`}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        {label('Title')}
        <input
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          className={fieldClass('title')}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          {label('Funder')}
          <input
            value={draft.funder}
            onChange={(e) => set('funder', e.target.value)}
            className={fieldClass('funder')}
          />
        </div>
        <div className="min-w-0">
          {label('Country')}
          <input
            value={draft.country}
            onChange={(e) => set('country', e.target.value)}
            className={fieldClass('country')}
          />
        </div>
      </div>

      <div>
        {label('Source URL — the funder\'s own page')}
        <input
          value={draft.sourceUrl}
          onChange={(e) => set('sourceUrl', e.target.value)}
          placeholder="https://…"
          className={fieldClass('sourceUrl')}
        />
        <p className="text-xs text-tertiary mt-1.5">
          A listing or aggregator site will be refused — this has to be the page that funds it.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          {label('Deadline')}
          {/* Date input, never free text: this value drives the reminder cron. */}
          <input
            type="date"
            value={draft.deadline}
            onChange={(e) => set('deadline', e.target.value)}
            className={fieldClass('deadline')}
          />
        </div>
        <div className="min-w-0">
          {label('Source type')}
          <select
            value={draft.sourceType}
            onChange={(e) => set('sourceType', e.target.value)}
            className={fieldClass('sourceType')}
          >
            <option value="">Choose…</option>
            {SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="min-w-0">
          {label('Currency')}
          <input
            value={draft.amountCurrency}
            onChange={(e) => set('amountCurrency', e.target.value)}
            className={fieldClass('amountCurrency')}
          />
        </div>
        <div className="min-w-0">
          {label('Amount')}
          <input
            value={draft.amountValue}
            onChange={(e) => set('amountValue', e.target.value)}
            inputMode="decimal"
            className={fieldClass('amountValue')}
          />
        </div>
        <div className="min-w-0 col-span-2 sm:col-span-1">
          {label('Type')}
          <select
            value={draft.amountType}
            onChange={(e) => set('amountType', e.target.value)}
            className={fieldClass('amountType')}
          >
            {AMOUNT_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {arrayField('degreeLevels', 'Degree levels')}
        {arrayField('fieldsOfStudy', 'Fields of study')}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {arrayField('eligibleNationalities', 'Eligible nationalities')}
        <div className="min-w-0">
          {label('Minimum GPA')}
          <input
            value={draft.minGpa}
            onChange={(e) => set('minGpa', e.target.value)}
            inputMode="decimal"
            className={fieldClass('minGpa')}
          />
        </div>
      </div>

      {arrayField('benefits', 'What the award covers', 3)}
      {arrayField('eligibility', 'Eligibility', 3)}
      {arrayField('requiredDocs', 'Required documents', 3)}

      <div>
        {label('Requirements')}
        <textarea
          value={draft.requirements}
          onChange={(e) => set('requirements', e.target.value)}
          rows={2}
          className={`${fieldClass('requirements')} resize-none text-sm`}
        />
      </div>

      <div>
        {label('Description')}
        <textarea
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          className={`${fieldClass('description')} resize-none text-sm`}
        />
      </div>
    </div>
  );
}
