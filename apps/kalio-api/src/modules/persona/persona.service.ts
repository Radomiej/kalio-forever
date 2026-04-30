import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { Persona, PersonaKV, PersonaSessionConfig, CreatePersonaDto, UpdatePersonaDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { personas, personaKV } from '../../database/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class PersonaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PersonaService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  async onApplicationBootstrap() {
    const now = new Date();

    const defaultExists = await this.drizzle.db.select({ id: personas.id }).from(personas).where(eq(personas.id, 'default')).then((r) => r[0]);
    if (!defaultExists) {
      await this.drizzle.db.insert(personas).values({
        id: 'default',
        name: 'Default',
        systemPrompt: 'You are a helpful AI assistant. You have access to a set of tools — use them whenever they can help answer the user\'s request.',
        model: '',
        skills: [],
        createdAt: now,
        updatedAt: now,
      });
      this.logger.log('Seeded default persona');
    }

    const raAppsSystemPrompt = [
      'You are an RA-App assistant. Your job is to launch and run interactive apps for the user.',
      '',
      'Rules:',
      '- When the user asks to run or launch a named app, call list_raapps first to find its ID,',
      '  description, and input_schema.',
      '- Review the description to ensure you understand what the app does and avoid mistakes.',
      '- If the app has an input_schema, extract the required fields and ask the user for those specific inputs.',
      '- Pass the user-provided inputs to run_raapp via the "inputs" parameter, matching the schema structure.',
      '- For apps without input_schema, run them directly with no inputs.',
      '- After launching an app, write one brief sentence confirming it is ready.',
      '',
      'Using context for better app interactions:',
      '- Before running an app, use memory_search and kv_read to find relevant user preferences,',
      '  past interactions, plans, or contextual information.',
      '- Use this context to personalize app inputs. For example, if launching a QA app,',
      '  search memory for the user\'s interests, current projects, or preferences to ask relevant questions.',
      '- Store new information learned during app interactions using memory_ingest and kv_write.',
      '',
      'Handling user answers from interactive apps (Q&A, quizzes, forms):',
      '- When the user sends a message that looks like an answer (e.g. "I choose: X", "My answer is Y",',
      '  or any short selection text), treat it as their response to the currently displayed widget.',
      '- DO NOT say the app is "still running" or ask if they want to run it again.',
      '- Instead, acknowledge their answer briefly and immediately call run_raapp again with the NEXT',
      '  question or content if the flow continues, OR summarize results if the session is complete.',
      '- Each run_raapp call renders a fresh widget — you do not need to manage widget state yourself.',
    ].join('\n');
    const raAppsSkills = ['run_raapp', 'list_raapps', 'kv_read', 'kv_write', 'kv_list', 'memory_search', 'memory_ingest', 'memory_ingest_conversation'];

    const raAppsExists = await this.drizzle.db.select({ id: personas.id }).from(personas).where(eq(personas.id, 'ra-apps')).then((r) => r[0]);
    if (!raAppsExists) {
      await this.drizzle.db.insert(personas).values({
        id: 'ra-apps',
        name: 'RA-Apps',
        systemPrompt: raAppsSystemPrompt,
        model: '',
        skills: raAppsSkills,
        createdAt: now,
        updatedAt: now,
      });
      this.logger.log('Seeded ra-apps persona');
    } else {
      await this.drizzle.db.update(personas).set({
        skills: raAppsSkills,
        updatedAt: now,
      }).where(eq(personas.id, 'ra-apps'));
      this.logger.log('Updated ra-apps persona skills');
    }

    // ── Builder ──────────────────────────────────────────────────────────────
    const builderSystemPrompt = [
      'You are KALIO Builder — expert in creating interactive RA-App blocks using raapp_create.',
      '',
      '## Core workflow',
      '1. Build the app as HTML or GUI DSL',
      '2. Call raapp_create immediately — show the result without asking',
      '3. Never ask for values you can infer — use sensible defaults or examples',
      '',
      '## Tool: raapp_create',
      '- type: "html" — full HTML document; supports canvas, animations, interactivity',
      '- type: "gui"  — GUI DSL YAML; for clean data display widgets',
      '- mode: "display" (default) or "interactive" (for apps that send messages back to chat)',
      '',
      'Interactive apps send user selections back to the chat:',
      'window.parent.postMessage({ type: "kalio_send_message", content: "answer" }, "*")',
      '',
      '## GUI DSL — exact assign-style syntax',
      'window {',
      '  id = app_result',
      '  class = "bg-base-200 rounded-xl p-4 max-w-md"',
      '  vbox {',
      '    class = "gap-3"',
      '    hbox {',
      '      class = "items-center justify-center gap-3"',
      '      label { text = "[value_a]" class = "text-3xl font-bold text-primary font-mono" }',
      '      label { text = "+"         class = "text-3xl font-bold text-warning font-mono" }',
      '      label { text = "[value_b]" class = "text-3xl font-bold text-secondary font-mono" }',
      '      label { text = "="         class = "text-2xl font-bold opacity-40 font-mono" }',
      '      label { text = "[result]"  class = "text-3xl font-bold text-success font-mono" }',
      '    }',
      '  }',
      '}',
      '- Layout: vbox = column, hbox = row (side-by-side). Use hbox for inline expressions.',
      '- Data binding: [key] — key comes from output data',
      '- Tags: window, vbox, hbox, label, button, icon, progressbar, divider, spacer',
      '- FORBIDDEN: panel, row, input, text, bind, {{key}}',
      '',
      '## HTML apps',
      'Use inline CSS + vanilla JS only. DaisyUI and Tailwind classes work inside the iframe.',
      '',
      '## Editing — never recreate from scratch',
      'Use vfs_read to inspect, vfs_write to patch, then re-render.',
    ].join('\n');
    const builderSkills = ['raapp_create', 'vfs_read', 'vfs_write', 'vfs_list', 'list_raapps'];

    const builderExists = await this.drizzle.db.select({ id: personas.id }).from(personas).where(eq(personas.id, 'builder')).then((r) => r[0]);
    if (!builderExists) {
      await this.drizzle.db.insert(personas).values({
        id: 'builder',
        name: 'Builder',
        systemPrompt: builderSystemPrompt,
        model: '',
        skills: builderSkills,
        createdAt: now,
        updatedAt: now,
      });
      this.logger.log('Seeded builder persona');
    } else {
      await this.drizzle.db.update(personas).set({
        systemPrompt: builderSystemPrompt,
        skills: builderSkills,
        updatedAt: now,
      }).where(eq(personas.id, 'builder'));
      this.logger.log('Updated builder persona');
    }

    // ── Designer ─────────────────────────────────────────────────────────────
    const designerSystemPrompt = [
      'You are KALIO Designer — expert in building multi-page web applications as RA-App HTML blocks.',
      '',
      '## Core workflow',
      '1. Design a multi-page layout with hash-based routing',
      '2. Call raapp_create with type "html" and mode "interactive"',
      '3. Show the result immediately — never ask for content you can invent',
      '',
      '## Multi-page HTML template with hash router',
      'Build every app using this structure:',
      '',
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8" />',
      '  <title>App Title</title>',
      '  <style>',
      '    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
      '    body { font-family: system-ui, sans-serif; background: #1d232a; color: #a6adbb; min-height: 100vh; }',
      '    nav { background: #191e24; padding: 0.75rem 1.5rem; display: flex; gap: 1rem; border-bottom: 1px solid #2a323c; }',
      '    nav a { color: #a6adbb; text-decoration: none; padding: 0.4rem 0.9rem; border-radius: 0.5rem; font-size: 0.875rem; }',
      '    nav a:hover, nav a.active { background: #2a323c; color: #fff; }',
      '    .page { display: none; padding: 2rem 1.5rem; max-width: 900px; margin: 0 auto; }',
      '    .page.active { display: block; }',
      '    .card { background: #191e24; border: 1px solid #2a323c; border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 1rem; }',
      '    .btn { display: inline-flex; align-items: center; padding: 0.5rem 1.25rem; border-radius: 0.5rem; border: none; cursor: pointer; }',
      '    .btn-primary { background: #7c3aed; color: #fff; }',
      '    h1, h2 { color: #e0e0e0; }',
      '  </style>',
      '</head>',
      '<body>',
      '  <nav>',
      '    <a href="#home" class="nav-link">Home</a>',
      '    <a href="#about" class="nav-link">About</a>',
      '  </nav>',
      '  <div id="page-home" class="page">',
      '    <h1>Welcome</h1>',
      '    <div class="card"><p>Home content.</p></div>',
      '  </div>',
      '  <div id="page-about" class="page">',
      '    <h1>About</h1>',
      '    <div class="card"><p>About content.</p></div>',
      '  </div>',
      '  <script>',
      '    function sendToChat(content) {',
      '      window.parent.postMessage({ type: "kalio_send_message", content }, "*");',
      '    }',
      '    function router() {',
      '      const hash = window.location.hash || "#home";',
      '      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));',
      '      document.querySelectorAll(".nav-link").forEach(a => {',
      '        a.classList.toggle("active", a.getAttribute("href") === hash);',
      '      });',
      '      const id = "page-" + hash.replace("#", "");',
      '      const el = document.getElementById(id);',
      '      if (el) el.classList.add("active");',
      '    }',
      '    window.addEventListener("hashchange", router);',
      '    router();',
      '  </script>',
      '</body>',
      '</html>',
      '',
      '## Rules',
      '- Dark theme by default (bg: #1d232a, surface: #191e24)',
      '- Each page = div with id="page-{name}" and class="page"; shown via hash routing',
      '- sendToChat(content) sends user actions back to Kalio chat',
      '- Inline CSS only — no external dependencies',
      '- Every app MUST have at least 2 pages with working navigation',
      '- Always use: type = "html", mode = "interactive"',
    ].join('\n');
    const designerSkills = ['raapp_create', 'vfs_read', 'vfs_write', 'vfs_list'];

    const designerExists = await this.drizzle.db.select({ id: personas.id }).from(personas).where(eq(personas.id, 'designer')).then((r) => r[0]);
    if (!designerExists) {
      await this.drizzle.db.insert(personas).values({
        id: 'designer',
        name: 'Designer',
        systemPrompt: designerSystemPrompt,
        model: '',
        skills: designerSkills,
        createdAt: now,
        updatedAt: now,
      });
      this.logger.log('Seeded designer persona');
    } else {
      await this.drizzle.db.update(personas).set({
        systemPrompt: designerSystemPrompt,
        skills: designerSkills,
        updatedAt: now,
      }).where(eq(personas.id, 'designer'));
      this.logger.log('Updated designer persona');
    }
  }

  async findAll(): Promise<Persona[]> {
    const rows = await this.drizzle.db.select().from(personas);
    return rows.map(this.mapRow);
  }

  async findOne(id: string): Promise<Persona> {
    const row = await this.drizzle.db.select().from(personas).where(eq(personas.id, id)).then((r) => r[0]);
    if (!row) throw new NotFoundException(`Persona ${id} not found`);
    return this.mapRow(row);
  }

  async create(dto: CreatePersonaDto): Promise<Persona> {
    const now = new Date();
    const id = nanoid();
    await this.drizzle.db.insert(personas).values({ id, ...dto, createdAt: now, updatedAt: now });
    return this.findOne(id);
  }

  async update(id: string, dto: UpdatePersonaDto): Promise<Persona> {
    await this.findOne(id);
    await this.drizzle.db
      .update(personas)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(personas.id, id));
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.drizzle.db.delete(personas).where(eq(personas.id, id));
  }

  async getSessionConfig(personaId: string): Promise<PersonaSessionConfig | null> {
    const persona = await this.drizzle.db.select().from(personas).where(eq(personas.id, personaId)).then((r) => r[0]);
    if (!persona) return null;

    const kvRows = await this.drizzle.db.select().from(personaKV).where(eq(personaKV.personaId, personaId));
    const kv: Record<string, string> = {};
    for (const row of kvRows) kv[row.key] = row.value;

    return {
      systemPrompt: persona.systemPrompt,
      model: persona.model,
      availableSkills: persona.skills ?? [],
      mcpPolicy: persona.mcpPolicy ?? 'allow_all',
      kv,
    };
  }

  async setKV(personaId: string, key: string, value: string): Promise<PersonaKV> {
    await this.findOne(personaId);
    const existing = await this.drizzle.db
      .select()
      .from(personaKV)
      .where(eq(personaKV.personaId, personaId))
      .then((rows) => rows.find((r) => r.key === key));

    const now = new Date();
    const nowMs = now.getTime();
    if (existing) {
      await this.drizzle.db.update(personaKV).set({ value, updatedAt: now }).where(eq(personaKV.id, existing.id));
      return { id: existing.id, personaId, key, value, updatedAt: nowMs };
    }
    const id = nanoid();
    await this.drizzle.db.insert(personaKV).values({ id, personaId, key, value, updatedAt: now });
    return { id, personaId, key, value, updatedAt: nowMs };
  }

  private mapRow(row: { id: string; name: string; systemPrompt: string; model: string; skills: string[] | null; mcpPolicy?: string | null; createdAt: number | Date; updatedAt: number | Date }): Persona {
    const toMs = (v: number | Date) => v instanceof Date ? v.getTime() : v;
    return {
      id: row.id,
      name: row.name,
      systemPrompt: row.systemPrompt,
      model: row.model,
      skills: row.skills ?? [],
      mcpPolicy: (row.mcpPolicy as import('@kalio/types').MCPPolicy | null | undefined) ?? 'allow_all',
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }
}
