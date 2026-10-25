import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import HealthDashboard from './HealthDashboard';

vi.mock('../lib/health', () => ({
  fetchHealth: vi.fn(async () => ({
    status: 'healthy',
    services: { backend: { status: 'healthy', status_code: 200 } }
  })),
  normalizeServiceStatus: (s: string) => s
}));

afterEach(cleanup);

describe('HealthDashboard as a non-modal panel', () => {
  it('is a dialog that does not claim to be modal (the map stays usable behind it)', async () => {
    render(
      <>
        <button type="button">Kartknapp</button>
        <HealthDashboard onClose={() => {}} />
      </>
    );
    await act(async () => {});
    const dialog = screen.getByRole('dialog', { name: 'Systemhelse' });
    expect(dialog).not.toHaveAttribute('aria-modal');
  });

  it('closes on Escape from inside the panel', async () => {
    const onClose = vi.fn();
    render(<HealthDashboard onClose={onClose} />);
    await act(async () => {});
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Systemhelse' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('HealthDashboard optional services', () => {
  it('marks an optional service as such and does not paint it as a failure', async () => {
    const { fetchHealth } = await import('../lib/health');
    vi.mocked(fetchHealth).mockResolvedValueOnce({
      status: 'healthy',
      services: {
        nominatim: { status: 'healthy', status_code: 200, optional: false },
        'graphhopper-maps': { status: 'unhealthy', detail: 'timeout', optional: true }
      }
    });
    render(<HealthDashboard onClose={() => {}} />);
    await act(async () => {});
    expect(screen.getByText('GraphHopper Maps')).toBeInTheDocument();
    expect(screen.getByText('Utilgjengelig (valgfri)')).toBeInTheDocument();
    expect(screen.getByText('Alle tjenester er i drift')).toBeInTheDocument();
  });
});

describe('HealthDashboard service labels', () => {
  it('names the LLM probe in Norwegian', async () => {
    const { fetchHealth } = await import('../lib/health');
    vi.mocked(fetchHealth).mockResolvedValueOnce({
      status: 'healthy',
      services: {
        nominatim: { status: 'healthy', status_code: 200 },
        llm: { status: 'healthy', status_code: 200, optional: true }
      }
    });
    render(<HealthDashboard onClose={() => {}} />);
    await act(async () => {});
    expect(screen.getByText('Språkmodell (LLM)')).toBeInTheDocument();
  });
});
