// Reporte en texto (el JSON es el objeto devuelto por migrate()).
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

export function formatText(r) {
  const L = [];
  L.push(`== Importación MariaDB -> PostgreSQL (${r.mode === 'master' ? 'BD maestra' : `colegio ${r.tenant}`}) ==`);
  L.push(`origen: ${r.source.db}   destino: ${r.target.db}${r.target.created ? ' (creada)' : ''}`);
  L.push(`inicio: ${r.startedAt}   fin: ${r.finishedAt}`);
  L.push(`opciones: fix=${r.options.fix} dry-run=${r.options.dryRun} verify-only=${r.options.verifyOnly} truncate=${r.options.truncate} batch=${r.options.batch} datetime-tz=${r.options.datetimeZone}`);
  L.push(`ESTADO: ${r.status.toUpperCase()} — ${r.message ?? ''}`);
  if (r.migrationsMissing.length) {
    L.push('', 'Migraciones v2 faltantes en el origen:');
    for (const m of r.migrationsMissing) L.push(`  - ${m.migration}: falta ${m.missing.join(', ')}`);
  }
  if (r.target.schemaApplied) L.push('', `Esquema aplicado: ${r.target.schemaApplied.join(', ')}`);
  if (r.replicationRole) L.push(`session_replication_role: ${r.replicationRole}`);
  L.push('', `Conflictos (${r.conflicts.length}):`);
  if (!r.conflicts.length) L.push('  ninguno');
  for (const c of r.conflicts) {
    const st = c.fixed === c.count ? `corregido (${c.appliedRule})` : c.fixed ? `corregido ${c.fixed}/${c.count}` : c.severity === 'error' ? (c.unfixable || !c.fixRule ? 'BLOQUEA (corregir a mano en el origen)' : 'BLOQUEA (use --fix)') : 'aviso (--fix lo corrige)';
    L.push(`  [${c.severity}] ${c.code} ${c.table}.${c.column}: ${c.count} fila(s) — ${c.description} — ${st}`);
    if (c.fixRule && !c.unfixable && c.fixed < c.count) L.push(`      regla --fix: ${c.fixRule}`);
    for (const s of c.samples ?? []) L.push(`      ej.: pk=${s.pk ?? JSON.stringify(s)} valor=${JSON.stringify(s.value)}`);
  }
  if (r.fkOrphans.length) {
    L.push('', 'Referencias huérfanas en el origen:');
    for (const o of r.fkOrphans) L.push(`  ${o.fk}: ${o.table}(${o.columns.join(',')}) -> ${o.refTable}: ${o.distinctValues} valor(es)`);
  }
  if (r.skippedColumns.length) {
    L.push('', 'Columnas no copiadas:');
    for (const s of r.skippedColumns) L.push(`  ${s.table}.${s.column}: ${s.reason}`);
  }
  if (r.warnings.length) {
    L.push('', 'Avisos:');
    for (const w of r.warnings) L.push(`  - ${w}`);
  }
  if (r.verification.length) {
    L.push('', 'Verificación (filas, md5 de PK, md5 de filas, sumas numeric):');
    L.push(`  ${pad('tabla', 34)} ${lpad('origen', 8)} ${lpad('destino', 8)}  pk   filas sumas  ok`);
    for (const v of r.verification) {
      const sums = v.numericSums.length ? (v.numericSums.every((s) => s.source === s.target) ? 'igual' : 'DIF') : '-';
      L.push(`  ${pad(v.table, 34)} ${lpad(v.sourceRows, 8)} ${lpad(v.targetRows, 8)}  ${v.idsDigest.source === v.idsDigest.target ? 'igual' : 'DIF  '} ${v.rowsDigest.source === v.rowsDigest.target ? 'igual' : 'DIF  '} ${pad(sums, 5)} ${v.ok ? 'sí' : 'NO'}`);
      for (const s of v.numericSums.filter((x) => x.source !== x.target)) L.push(`      SUM(${s.column}): origen ${s.source} destino ${s.target}`);
      if (v.excludedColumns.length) L.push(`      columnas excluidas de la suma (corregidas a DEFAULT): ${v.excludedColumns.join(', ')}`);
    }
    if (r.totals) L.push(`  TOTAL: ${r.totals.tables} tablas, ${r.totals.sourceRows} filas origen, ${r.totals.targetRows} filas destino, ${r.totals.tablesOk}/${r.totals.tables} iguales`);
  }
  if (r.sequences.length) {
    L.push('', 'Secuencias de identidad (siguiente valor):');
    L.push(`  ${r.sequences.map((s) => `${s.table}.${s.column}=${s.next}`).join('  ')}`);
  }
  return L.join('\n');
}
