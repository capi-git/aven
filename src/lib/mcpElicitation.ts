/**
 * MCP elicitation (a connected server asking the user for input) mapped onto
 * Aven's shared question card, and the user's reply mapped back to the
 * `{ action, content }` result the MCP server expects.
 */
import {
  selectedAnswerLabels,
  type UserQuestion,
  type UserQuestionOption,
  type UserQuestionReply,
} from "./userQuestion";

export type McpElicitation = {
  serverName: string;
  message: string;
  mode: "form" | "url";
  /** JSON Schema of the requested object (form mode). */
  schema?: Record<string, unknown>;
  /** Page the server wants the user to visit (url mode). */
  url?: string;
};

export type McpElicitationResult = {
  action: "accept" | "decline" | "cancel";
  content: Record<string, unknown> | null;
};

type Field = {
  key: string;
  type: "enum" | "multi" | "boolean" | "number" | "integer" | "string";
  /** Option id → value sent back to the server. */
  values: Map<string, unknown>;
  required: boolean;
};

export type McpElicitationPrompt = {
  title: string;
  questions: UserQuestion[];
  fields: Field[];
};

const CONTINUE_ID = "continue";
const DECLINE_ID = "decline";
const CONFIRM_KEY = "__confirm__";

export function elicitationPrompt(request: McpElicitation): McpElicitationPrompt {
  const title = `${request.serverName}: ${request.message}`.slice(0, 240);
  if (request.mode === "url") {
    const prompt = request.url
      ? `${request.message}\n\nOpen this page to continue: ${request.url}`
      : request.message;
    return { title, questions: [confirmQuestion(prompt, "Done")], fields: [] };
  }

  const properties = asRecord(request.schema?.properties) ?? {};
  const required = new Set(
    Array.isArray(request.schema?.required)
      ? request.schema.required.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  );
  const questions: UserQuestion[] = [];
  const fields: Field[] = [];
  for (const [key, raw] of Object.entries(properties)) {
    const prop = asRecord(raw);
    if (!prop) continue;
    const field = fieldFromSchema(key, prop, required.has(key));
    if (!field) continue;
    fields.push(field.field);
    questions.push(field.question);
  }
  if (questions.length === 0) {
    return {
      title,
      questions: [confirmQuestion(request.message, "Continue")],
      fields: [],
    };
  }
  if (questions[0] && !questions[0].header) {
    questions[0] = { ...questions[0], header: request.serverName };
  }
  return { title, questions, fields };
}

export function elicitationResult(
  prompt: McpElicitationPrompt,
  reply: UserQuestionReply | "cancelled",
): McpElicitationResult {
  if (reply === "cancelled") return { action: "cancel", content: null };
  if (reply.kind === "skipped") return { action: "decline", content: null };

  if (prompt.fields.length === 0) {
    const choice = reply.answers[CONFIRM_KEY]?.[0];
    return choice === CONTINUE_ID
      ? { action: "accept", content: {} }
      : { action: "decline", content: null };
  }

  const content: Record<string, unknown> = {};
  for (const [index, field] of prompt.fields.entries()) {
    const question = prompt.questions[index];
    if (!question) continue;
    const value = fieldValue(field, question, reply);
    if (value === undefined) {
      if (field.required) return { action: "decline", content: null };
      continue;
    }
    content[field.key] = value;
  }
  return { action: "accept", content };
}

function fieldFromSchema(
  key: string,
  prop: Record<string, unknown>,
  required: boolean,
): { field: Field; question: UserQuestion } | null {
  const label = stringField(prop, "title") ?? key;
  const description = stringField(prop, "description");
  const base = {
    id: key,
    header: label,
    prompt: description ?? label,
  };
  const type = stringField(prop, "type");

  if (type === "array") {
    const items = asRecord(prop.items);
    const options = enumOptions(items ?? {});
    if (!options) return null;
    return {
      field: { key, type: "multi", values: options.values, required },
      question: {
        ...base,
        multiSelect: true,
        allowCustom: false,
        options: options.options,
      },
    };
  }

  const options = enumOptions(prop);
  if (options) {
    return {
      field: { key, type: "enum", values: options.values, required },
      question: {
        ...base,
        multiSelect: false,
        allowCustom: false,
        options: options.options,
      },
    };
  }

  if (type === "boolean") {
    return {
      field: {
        key,
        type: "boolean",
        values: new Map<string, unknown>([
          ["true", true],
          ["false", false],
        ]),
        required,
      },
      question: {
        ...base,
        multiSelect: false,
        allowCustom: false,
        options: [
          { id: "true", label: "Yes" },
          { id: "false", label: "No" },
        ],
      },
    };
  }

  if (type === "number" || type === "integer" || type === "string") {
    return {
      field: { key, type, values: new Map(), required },
      question: { ...base, multiSelect: false, allowCustom: true, options: [] },
    };
  }
  return null;
}

/** `enum` (+ legacy `enumNames`), or titled `oneOf` / `anyOf` const options. */
function enumOptions(
  schema: Record<string, unknown>,
): { options: UserQuestionOption[]; values: Map<string, unknown> } | null {
  const values = new Map<string, unknown>();
  const options: UserQuestionOption[] = [];
  const add = (value: unknown, label?: string) => {
    if (value === null || value === undefined) return;
    const id = String(value);
    if (values.has(id)) return;
    values.set(id, value);
    options.push({ id, label: label || id });
  };

  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    schema.enum.forEach((value, index) => {
      const name = names[index];
      add(value, typeof name === "string" ? name : undefined);
    });
  } else {
    const variants = Array.isArray(schema.oneOf)
      ? schema.oneOf
      : Array.isArray(schema.anyOf)
        ? schema.anyOf
        : [];
    for (const variant of variants) {
      const rec = asRecord(variant);
      if (rec && "const" in rec) add(rec.const, stringField(rec, "title"));
    }
  }
  return options.length > 0 ? { options, values } : null;
}

function fieldValue(
  field: Field,
  question: UserQuestion,
  reply: Extract<UserQuestionReply, { kind: "answered" }>,
): unknown {
  const selected = reply.answers[field.key] ?? [];
  if (field.type === "multi") {
    const values = selected.flatMap((id) =>
      field.values.has(id) ? [field.values.get(id)] : [],
    );
    return values.length > 0 ? values : undefined;
  }
  if (field.type === "enum" || field.type === "boolean") {
    const id = selected[0];
    return id !== undefined && field.values.has(id)
      ? field.values.get(id)
      : undefined;
  }
  const text = selectedAnswerLabels(question, reply)[0]?.trim();
  if (!text) return undefined;
  if (field.type === "string") return text;
  const number = Number(text);
  if (!Number.isFinite(number)) return undefined;
  return field.type === "integer" ? Math.trunc(number) : number;
}

function confirmQuestion(prompt: string, accept: string): UserQuestion {
  return {
    id: CONFIRM_KEY,
    prompt,
    multiSelect: false,
    allowCustom: false,
    options: [
      { id: CONTINUE_ID, label: accept },
      { id: DECLINE_ID, label: "Decline" },
    ],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  rec: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = rec[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
