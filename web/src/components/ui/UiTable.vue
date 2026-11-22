<script setup lang="ts">
interface TableColumn {
  key: string
  label: string
  width?: string
  align?: 'left' | 'right' | 'center'
}

type Row = any

const props = withDefaults(
  defineProps<{
    columns: TableColumn[]
    rows: Row[]
    rowKey?: string
    clickable?: boolean
    emptyText?: string
  }>(),
  { rowKey: 'id', clickable: false, emptyText: '暂无数据' },
)

const emit = defineEmits<{ (e: 'row-click', row: Row, index: number): void }>()

function keyOf(row: Row, index: number): string {
  const key = props.rowKey
  const value = row?.[key]
  return String(value ?? index)
}

function onRowClick(row: Row, index: number): void {
  if (!props.clickable) return
  emit('row-click', row, index)
}
</script>

<template>
  <div class="tbl-block">
    <div class="tbl-scroll">
      <table class="tbl">
        <colgroup>
          <col v-for="col in columns" :key="`col-${col.key}`" :style="col.width ? { width: col.width } : undefined" />
        </colgroup>
        <thead>
          <tr>
            <th v-for="col in columns" :key="col.key" :class="`is-${col.align ?? 'left'}`">
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="keyOf(row, index)"
            :class="{ 'is-clickable': clickable }"
            @click="onRowClick(row, index)"
          >
            <td v-for="col in columns" :key="col.key" :class="`is-${col.align ?? 'left'}`">
              <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]" :index="index">
                {{ row[col.key] ?? '--' }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="!rows.length" class="tbl__empty">
      <slot name="empty">
        <p class="tbl__empty-text">{{ emptyText }}</p>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.tbl-block {
  width: 100%;
}

.tbl-scroll {
  width: 100%;
  overflow-x: auto;
}

.tbl {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}

.tbl th {
  height: 40px;
  padding: 0 16px;
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--c-text-label);
  white-space: nowrap;
  text-align: left;
}

.tbl td {
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--c-border);
  font-size: 13px;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tbl tbody tr:last-child td {
  border-bottom: none;
}

.tbl tbody tr {
  transition: background-color var(--t);
  background: var(--c-surface);
}

.tbl tbody tr:hover {
  background: #f8fafc;
}

.tbl tbody tr.is-clickable {
  cursor: pointer;
}

.tbl .is-right {
  text-align: right;
}

.tbl .is-center {
  text-align: center;
}

.tbl__empty {
  padding: 44px 16px;
  text-align: center;
}

.tbl__empty-text {
  font-size: 13px;
  color: var(--c-text-3);
  line-height: 1.6;
}
</style>
