import { cn } from "@/lib/utils";

interface CaregiverBadgeProps {
  role: 'primary_caregiver' | 'caregiver' | 'hired_caregiver' | 'observer';
  className?: string;
}

const roleMap = {
  primary_caregiver: { label: 'Cuidador Principal', className: 'bg-primary/10 text-primary border-primary/20' },
  caregiver: { label: 'Cuidador', className: 'bg-secondary text-secondary-foreground border-secondary-foreground/10' },
  hired_caregiver: { label: 'Profissional', className: 'bg-zelo-amber/10 text-zelo-amber-fg border-zelo-amber/20' },
  observer: { label: 'Observador', className: 'bg-muted text-muted-foreground border-border' },
};

export function CaregiverBadge({ role, className }: CaregiverBadgeProps) {
  const config = roleMap[role];
  
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-1 rounded-full text-[14px] font-medium border",
      config.className,
      className
    )}>
      {config.label}
    </span>
  );
}