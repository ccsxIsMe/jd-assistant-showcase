import { cn } from '@/lib/utils';
export function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn('rounded-2xl border border-slate-200 bg-white p-6 shadow-sm', className)}
      {...props}
    />
  );
}
