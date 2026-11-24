import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SiteAssociationCampaignDTO } from '@netball-trials/types';
import { SiteCommunicationsPage } from './SiteCommunicationsPage';

afterEach(cleanup);

const campaign: SiteAssociationCampaignDTO = {
  id: 'campaign-1', eventIds: ['e1', 'e2'], eventNames: ['Spring Trials', 'Open Trials'], associationIds: ['a1'],
  batchId: 'site-batch-1', subject: 'Trials', body: 'Details', scheduledAt: null, status: 'COMPLETED',
  attempts: 1, error: null, createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z',
  deliveries: [{ id: 'mail-1', to: 'association@example.test', status: 'SENT', simulated: false, attempts: 1, sentAt: '2026-10-31T00:00:00.000Z', failedAt: null, error: null, associationName: 'MENA' }],
};

function makeClient() {
  return {
    listEvents: vi.fn().mockResolvedValue([
      { id: 'e1', name: 'Spring Trials', eventDate: '2027-09-12T00:00:00.000Z', division: '15/U', section: 'Ladies', status: 'OPEN' },
      { id: 'e2', name: 'Open Trials', eventDate: '2027-10-12T00:00:00.000Z', division: 'Open', section: 'Ladies', status: 'DRAFT' },
    ]),
    listAssociations: vi.fn().mockResolvedValue([
      { id: 'a1', name: 'MENA', active: true, primaryContactName: 'Morgan Contact', primaryContactEmail: 'association@example.test' },
    ]),
    listCommunicationTemplates: vi.fn().mockResolvedValue([]),
    listSiteAssociationCampaigns: vi.fn().mockResolvedValue([]),
    previewSiteAssociationCommunication: vi.fn().mockResolvedValue({
      count: 1,
      recipients: [{ id: 'a1', name: 'MENA — Morgan Contact', email: 'association@example.test', number: null, association: 'MENA', registrationStatus: null, checkedIn: null, positions: [] }],
      events: [], subject: 'Details for MENA', text: 'Spring Trials and Open Trials',
    }),
    sendSiteAssociationCommunication: vi.fn().mockResolvedValue(campaign),
    scheduleSiteAssociationCommunication: vi.fn().mockResolvedValue(campaign),
    updateSiteAssociationCommunication: vi.fn().mockResolvedValue({ ...campaign, subject: 'Updated', status: 'SCHEDULED' }),
    cancelSiteAssociationCommunication: vi.fn().mockResolvedValue({ status: 'CANCELLED' }),
    retrySiteAssociationCommunication: vi.fn().mockResolvedValue({ batchId: campaign.batchId, sent: 1, failed: 0, ambiguous: 0, pending: 0 }),
    saveCommunicationTemplate: vi.fn(), updateCommunicationTemplate: vi.fn(), deleteCommunicationTemplate: vi.fn(),
  };
}

describe('SiteCommunicationsPage', () => {
  it('requires confirmation before retrying ambiguous association deliveries', async () => {
    const client = makeClient();
    client.listSiteAssociationCampaigns.mockResolvedValue([{
      ...campaign,
      status: 'FAILED',
      error: 'delivery_0_failed_1_unknown_0_pending',
      deliveries: [{ ...campaign.deliveries[0], status: 'AMBIGUOUS', sentAt: null, failedAt: '2026-10-31T00:00:00.000Z', error: 'delivery_outcome_unknown' }],
    }]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SiteCommunicationsPage client={client as any} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry outcome-unknown deliveries' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('duplicate'));
    expect(client.retrySiteAssociationCommunication).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry outcome-unknown deliveries' }));
    await waitFor(() => expect(client.retrySiteAssociationCommunication).toHaveBeenCalledWith('campaign-1', ['mail-1'], true));
  });

  it('edits a scheduled association campaign through the existing composer', async () => {
    const client = makeClient();
    client.listSiteAssociationCampaigns.mockResolvedValue([{ ...campaign, scheduledAt: '2099-01-15T23:30:00.000Z', status: 'SCHEDULED', deliveries: [] }]);
    render(<SiteCommunicationsPage client={client as any} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit scheduled campaign' }));
    expect(screen.getByLabelText('Subject')).toHaveValue('Trials');
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview message' }));
    await screen.findByRole('heading', { name: 'Review association message' });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule changes' }));
    await waitFor(() => expect(client.updateSiteAssociationCommunication).toHaveBeenCalledWith('campaign-1', expect.objectContaining({ subject: 'Updated', expectedUpdatedAt: '2026-11-24T00:00:00.000Z' })));
  });

  it('previews and sends one association campaign across selected events', async () => {
    const client = makeClient();
    render(<SiteCommunicationsPage client={client as any} />);

    expect(await screen.findByRole('heading', { name: 'Communications' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Spring Trials/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Open Trials/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /MENA/ }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Details for {{associationName}}' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '{{eventList}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview message' }));

    expect(await screen.findByRole('heading', { name: 'Review association message' })).toBeInTheDocument();
    expect(screen.getByText('Spring Trials and Open Trials')).toBeInTheDocument();
    expect(client.previewSiteAssociationCommunication).toHaveBeenCalledWith({
      eventIds: ['e1', 'e2'], associationIds: ['a1'], subject: 'Details for {{associationName}}', text: '{{eventList}}',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send now to 1' }));
    await waitFor(() => expect(client.sendSiteAssociationCommunication).toHaveBeenCalledWith(expect.objectContaining({
      eventIds: ['e1', 'e2'], associationIds: ['a1'], subject: 'Details for {{associationName}}', text: '{{eventList}}', batchId: expect.any(String),
    })));
    expect(await screen.findByRole('status')).toHaveTextContent(/message completed: 1 sent, 0 simulated/i);
  });
});
