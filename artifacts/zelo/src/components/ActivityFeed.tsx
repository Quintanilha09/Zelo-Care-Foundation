/**
 * Feed de atividade recente da família — ZELO.
 * Mostra o audit log em linguagem natural.
 */
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Esqueleto, AreaCarregando } from '@/components/esqueleto';

interface ActivityItem {
  id: number;
  text: string;
  entityType: string;
  action: string;
  actorName: string;
  timestamp: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora mesmo';
  if (mins < 60) return `há ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `há ${days} dia${days > 1 ? 's' : ''}`;
}

function activityIcon(entityType: string): string {
  const icons: Record<string, string> = {
    dose_record: '💊',
    treatment: '📋',
    patient: '👤',
    caregiver: '🤝',
    caregiver_invite: '✉️',
    session: '🔑',
    data_export: '📦',
    deletion_request: '🗑️',
    user: '✨',
  };
  return icons[entityType] ?? '📝';
}

export function ActivityFeed({ limit = 20 }: { limit?: number }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch(`/api/activity?limit=${limit}`);
        if (!res.ok) throw new Error('Erro ao carregar atividade');
        setItems(await res.json() as ActivityItem[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [limit]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Atividade recente</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          // Esqueleto do projeto, não o `animate-pulse` do shadcn: aquele
          // pisca a opacidade em laço infinito e cansa quem tem sensibilidade
          // visual. Ver components/esqueleto.tsx (Issue #5).
          <AreaCarregando rotulo="Carregando a atividade recente">
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Esqueleto className="h-8 w-8 rounded-full" />
                  <div className="space-y-1 flex-1">
                    <Esqueleto className="h-4 w-3/4" />
                    <Esqueleto className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          </AreaCarregando>
        )}
        {!loading && error && (
          <p className="text-sm text-muted-foreground">{error}</p>
        )}
        {!loading && !error && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</p>
        )}
        {!loading && !error && items.length > 0 && (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <span className="text-xl leading-none mt-0.5" aria-hidden>
                  {activityIcon(item.entityType)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{item.text}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {timeAgo(item.timestamp)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
