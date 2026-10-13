import { runArchiScript } from './runner.js';
import type { MermaidExportRequest, RunResult } from '../types.js';

/**
 * jArchi script that walks one or more ArchiMate views and emits Markdown with
 * a Mermaid `flowchart` per view. Options are passed via `archiServer.options`.
 *
 * Kept as a `String.raw` literal so no backticks or `${` appear (the script
 * builds its Markdown fences at runtime instead).
 */
const MERMAID_EXPORT_SCRIPT = String.raw`
/* archi-server: export ArchiMate view(s) to Markdown + Mermaid. */
(function () {
  var opts = (typeof archiServer !== 'undefined' && archiServer.options) || {};
  var DIRECTIONS = ['LR', 'RL', 'TB', 'BT'];
  var direction = DIRECTIONS.indexOf(opts.direction) >= 0 ? opts.direction : 'LR';
  var includeRelationships = opts.relationships !== false;
  var FENCE = String.fromCharCode(96, 96, 96);

  function toArray(collection) {
    var out = [];
    collection.each(function (item) { out.push(item); });
    return out;
  }

  function humanize(type) {
    return String(type || 'element').replace(/-/g, ' ');
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/"/g, "'")
      .replace(/[\r\n]+/g, ' ')
      .replace(/[|]/g, '/')
      .trim();
  }

  function nodeKey(concept) {
    return 'n' + String(concept.id).replace(/[^A-Za-z0-9]/g, '');
  }

  function isRelationship(concept) {
    return /-relationship$/.test(String(concept.type || ''));
  }

  function folderPath(folder) {
    var parts = [];
    var current = folder;
    var guard = 0;
    while (current && guard < 60) {
      guard++;
      if (String(current.type || '') !== 'folder') break;
      parts.unshift(current.name);
      var parents = $(current).parent();
      current = parents.size() > 0 ? parents.get(0) : null;
    }
    return parts.join('/');
  }

  var views = [];
  if (opts.view) {
    var wanted = String(opts.view);
    views = toArray($(wanted.charAt(0) === '#' ? wanted : '#' + wanted));
    if (views.length === 0) {
      $('view').filter(function (v) { return v.name === wanted; }).each(function (v) { views.push(v); });
    }
  } else if (opts.folder) {
    var want = String(opts.folder);
    $('folder').filter(function (f) {
      return f.name === want || folderPath(f) === want;
    }).each(function (folder) {
      $(folder).find('view').each(function (v) { views.push(v); });
    });
  } else {
    views = toArray($('view'));
  }

  var seen = {};
  views = views.filter(function (v) {
    var id = String(v.id);
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  });

  if (views.length === 0) {
    archiServer.setResult({
      markdown: '',
      views: [],
      count: 0,
      error: 'no views matched ' + JSON.stringify({ view: opts.view || null, folder: opts.folder || null })
    });
    return;
  }

  function mermaidForView(view) {
    var nodes = {};
    var order = [];
    var edges = [];
    var seenEdge = {};

    $(view).find().each(function (obj) {
      var concept = obj.concept;
      if (!concept) return;
      if (isRelationship(concept)) {
        if (!includeRelationships) return;
        var src = obj.source;
        var tgt = obj.target;
        if (!src || !tgt || !src.concept || !tgt.concept) return;
        var sk = nodeKey(src.concept);
        var tk = nodeKey(tgt.concept);
        var ekey = sk + '>' + tk + ':' + String(concept.id);
        if (seenEdge[ekey]) return;
        seenEdge[ekey] = true;
        edges.push({ from: sk, to: tk, label: concept.name ? concept.name : humanize(concept.type) });
      } else {
        var key = nodeKey(concept);
        if (!nodes[key]) {
          nodes[key] = { name: concept.name || '(unnamed)', type: humanize(concept.type) };
          order.push(key);
        }
      }
    });

    var lines = [];
    lines.push(FENCE + 'mermaid');
    lines.push('flowchart ' + direction);
    order.forEach(function (key) {
      var n = nodes[key];
      lines.push('  ' + key + '["' + esc(n.name) + '<br/>(' + esc(n.type) + ')"]');
    });
    edges.forEach(function (edge) {
      lines.push('  ' + edge.from + ' -->|"' + esc(edge.label) + '"| ' + edge.to);
    });
    lines.push(FENCE);
    return { markdown: lines.join('\n'), nodes: order.length, edges: edges.length };
  }

  var parts = [];
  var summary = [];
  views.forEach(function (view) {
    var built = mermaidForView(view);
    var title = view.name || '(unnamed view)';
    var heading = '## ' + title;
    var doc = view.documentation ? String(view.documentation).trim() : '';
    parts.push(doc ? heading + '\n\n' + doc + '\n\n' + built.markdown : heading + '\n\n' + built.markdown);
    summary.push({
      id: String(view.id),
      name: title,
      type: String(view.type || ''),
      nodes: built.nodes,
      edges: built.edges
    });
  });

  archiServer.setResult({
    markdown: '# ArchiMate views\n\n' + parts.join('\n\n'),
    views: summary,
    count: summary.length
  });
})();
`;

export async function runMermaidExport(request: MermaidExportRequest): Promise<RunResult> {
  return runArchiScript({
    correlationId: request.correlationId,
    model: request.model,
    script: MERMAID_EXPORT_SCRIPT,
    options: {
      view: request.view ?? null,
      folder: request.folder ?? null,
      direction: request.direction ?? 'LR',
      relationships: request.relationships !== false,
    },
  });
}
