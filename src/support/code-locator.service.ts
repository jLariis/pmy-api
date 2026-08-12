import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CodeContext } from './prompt-builder';
import { GraphData, locateInGraph, routePath } from './code-locator';

interface GraphSource {
  repo: string;
  file: string;
}

interface CachedGraph {
  mtimeMs: number;
  data: GraphData;
}

/**
 * Carga los grafos de graphify (uno o varios repos) desde disco y resuelve el
 * contexto de código de un ticket. Best-effort: si un grafo no existe o no parsea,
 * se ignora y se degrada (el prompt sale con solo la ubicación). Cachea por archivo
 * con `mtimeMs` para releer solo cuando el grafo cambia (`graphify update`).
 */
@Injectable()
export class CodeLocatorService {
  private readonly logger = new Logger(CodeLocatorService.name);
  private readonly cache = new Map<string, CachedGraph>();

  /**
   * Fuentes de grafo. Config por env `SUPPORT_GRAPH_PATHS` con formato
   * "repo=ruta,repo2=ruta2". Default: el grafo del frontend hermano (`app-pmy`).
   */
  private sources(): GraphSource[] {
    const raw = process.env.SUPPORT_GRAPH_PATHS;
    if (raw) {
      return raw
        .split(',')
        .map((part) => part.split('='))
        .filter(([repo, file]) => repo && file)
        .map(([repo, file]) => ({ repo: repo.trim(), file: path.resolve(process.cwd(), file.trim()) }));
    }
    return [
      { repo: 'app-pmy', file: path.resolve(process.cwd(), '..', 'app-pmy', 'graphify-out', 'graph.json') },
      { repo: 'pmy-api', file: path.resolve(process.cwd(), 'graphify-out', 'graph.json') },
    ];
  }

  private load(source: GraphSource): GraphData | null {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(source.file);
    } catch {
      return null; // grafo ausente → degrada silenciosamente
    }
    const cached = this.cache.get(source.file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
    try {
      const parsed = JSON.parse(fs.readFileSync(source.file, 'utf8'));
      const data: GraphData = { nodes: parsed.nodes ?? [], links: parsed.links ?? [] };
      this.cache.set(source.file, { mtimeMs: stat.mtimeMs, data });
      return data;
    } catch (e: any) {
      this.logger.warn(`grafo ${source.file} no parseó: ${e?.message}`);
      return null;
    }
  }

  /** Pistas del ticket para el localizador (fuertes = específicas, débiles = amplias, text = libre). */
  private hintsFrom(t: TicketHints) {
    const lastSeg = routePath(t.route).split('/').pop() || undefined;
    return {
      route: t.route,
      strong: [t.submenu, t.subseccion, t.submenuError, t.nuevoMenu, lastSeg],
      weak: [t.menuPrincipal, t.seccion, t.menuError],
      // Todo lo que el usuario escribió: el grafo pesca términos reales (p. ej. "stat44").
      text: [t.titulo, t.descripcion, t.pasosReplicar],
    };
  }

  /**
   * Mejor contexto de código para el ticket entre todos los grafos configurados.
   * Elige el de mayor confianza (alta > media > ninguna) y, a igualdad, más archivos.
   */
  contextFor(t: TicketHints): CodeContext {
    const hints = this.hintsFrom(t);
    const rank = { alta: 3, media: 2, ninguna: 1 } as const;
    let best: CodeContext | null = null;

    for (const source of this.sources()) {
      const graph = this.load(source);
      if (!graph) continue;
      const cc = locateInGraph(graph, hints, source.repo);
      if (
        !best ||
        rank[cc.confidence] > rank[best.confidence] ||
        (rank[cc.confidence] === rank[best.confidence] && cc.files.length > best.files.length)
      ) {
        best = cc;
      }
    }

    return best ?? { repo: null, files: [], components: [], confidence: 'ninguna' };
  }
}

export interface TicketHints {
  route?: string | null;
  menuPrincipal?: string | null;
  submenu?: string | null;
  seccion?: string | null;
  subseccion?: string | null;
  menuError?: string | null;
  submenuError?: string | null;
  nuevoMenu?: string | null;
  // Texto libre del ticket para enriquecer la búsqueda en el grafo.
  titulo?: string | null;
  descripcion?: string | null;
  pasosReplicar?: string | null;
}
