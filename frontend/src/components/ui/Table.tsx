import React from 'react'
import { Inbox } from 'lucide-react'

export interface TableColumn {
  key: string
  label: string
  className?: string
}

export interface TableProps {
  columns: TableColumn[]
  children: React.ReactNode
  loading?: boolean
  empty?: boolean
  emptyTitle?: string
  emptyMessage?: string
  emptyAction?: React.ReactNode
  className?: string
}

export const Table: React.FC<TableProps> = ({
  columns,
  children,
  loading = false,
  empty = false,
  emptyTitle = 'No records found',
  emptyMessage = 'There are no items to display right now.',
  emptyAction,
  className = '',
}) => {
  return (
    <div className={`w-full overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/75 text-[11px] font-bold uppercase tracking-wider text-gray-500">
              {columns.map((col) => (
                <th key={col.key} className={`px-5 py-3.5 ${col.className || ''}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {loading ? (
              // Loading skeleton rows
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={index} className="animate-pulse">
                  {columns.map((col) => (
                    <td key={col.key} className="px-5 py-4">
                      <div className="h-4 bg-gray-200/70 rounded-md w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : empty ? (
              // Empty state
              <tr>
                <td colSpan={columns.length} className="px-6 py-14 text-center">
                  <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                    <div className="w-12 h-12 rounded-2xl bg-gray-50 text-gray-400 flex items-center justify-center mb-3 border border-gray-100">
                      <Inbox className="w-6 h-6" />
                    </div>
                    <h4 className="text-sm font-bold text-gray-900 mb-1">{emptyTitle}</h4>
                    <p className="text-xs text-gray-500 mb-4">{emptyMessage}</p>
                    {emptyAction && <div>{emptyAction}</div>}
                  </div>
                </td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Table

