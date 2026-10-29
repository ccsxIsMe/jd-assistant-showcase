import { cn } from '@/lib/utils';
export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn('field min-h-32 resize-y', className)}
      {...props}
    />
  );
}
