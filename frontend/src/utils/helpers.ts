import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format ISO date string to readable format */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date))
}

/** Truncate long strings */
export function truncate(str: string, maxLength: number = 50): string {
  return str.length > maxLength ? `${str.slice(0, maxLength)}…` : str
}

