/** Condición opcional: envuelve el bloque en {{#if <when>}} … {{/if}}. */
interface BlockBase { id: string; when?: string; }

export type EmailBlock =
  | (BlockBase & { type: 'heading'; text: string })
  | (BlockBase & { type: 'paragraph'; text: string })          // text puede incluir HTML simple (<b>, <br/>)
  | (BlockBase & { type: 'button'; text: string; url: string })
  | (BlockBase & { type: 'image'; src: string; alt?: string; width?: number })
  | (BlockBase & { type: 'divider' })
  | (BlockBase & { type: 'spacer'; size: number })
  | (BlockBase & { type: 'keyValue'; items: { label: string; value: string }[] }) // value = snippet Handlebars
  | (BlockBase & { type: 'table'; columns: { label: string; key: string }[]; rowsVar: string })
  | (BlockBase & { type: 'raw'; html: string });                // html = snippet Handlebars (va en mj-raw)

export interface EmailDoc { blocks: EmailBlock[]; }
