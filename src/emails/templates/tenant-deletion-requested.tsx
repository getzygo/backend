/**
 * Tenant Deletion Requested Template
 *
 * Sent to all workspace members when deletion is requested.
 * ALWAYS_SEND policy - cannot be disabled by user.
 *
 * Uses raw HTML for reliable Gmail rendering (not React Email).
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface TenantDeletionRequestedProps {
  firstName?: string;
  tenantName?: string;
  deletionScheduledAt?: Date;
  cancelableUntil?: Date;
  requestedBy?: string;
  reason?: string;
  appUrl?: string;
}

export function TenantDeletionRequested({
  firstName = 'there',
  tenantName = 'Your workspace',
  deletionScheduledAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  cancelableUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  requestedBy = 'an administrator',
  reason,
  appUrl = 'https://app.getzygo.com',
}: TenantDeletionRequestedProps): string {
  const formattedDeletionDate = deletionScheduledAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const formattedCancelDate = cancelableUntil.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const daysUntilDeletion = Math.ceil(
    (deletionScheduledAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  const name = escapeHtml(firstName);
  const workspace = escapeHtml(tenantName);
  const requestor = escapeHtml(requestedBy);
  const year = new Date().getFullYear();

  const reasonBlock = reason
    ? `<tr>
        <td style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;padding:0 0 4px">REASON</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#111827;padding:0 0 12px">${escapeHtml(reason)}</td>
      </tr>`
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Workspace Deletion Requested</title>
  <!--[if mso]>
  <style type="text/css">
    table { border-collapse: collapse; }
    .button-link { padding: 12px 24px !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
  <!-- Preview text -->
  <div style="display:none;max-height:0;overflow:hidden">${workspace} is scheduled for deletion on ${formattedDeletionDate}</div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6">
    <tr>
      <td align="center" style="padding:40px 20px">

        <!-- Main container -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%">

          <!-- Logo header -->
          <tr>
            <td align="center" style="padding:32px 40px 24px;border-bottom:1px solid #e5e7eb">
              <img src="https://demo.zygo.tech/logo.png" alt="Zygo" width="48" height="48" style="display:block;border:0" />
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td align="center" style="padding:32px 40px 8px">
              <h1 style="margin:0;font-size:24px;font-weight:600;color:#111827">Workspace deletion requested</h1>
            </td>
          </tr>

          <!-- Alert box -->
          <tr>
            <td style="padding:16px 40px 24px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#fef2f2;border-radius:8px;border-left:4px solid #ef4444;padding:16px 20px">
                    <strong style="color:#991b1b;font-size:14px">Action Required</strong>
                    <p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#374151">The workspace &ldquo;${workspace}&rdquo; has been scheduled for permanent deletion. All data will be archived and then removed.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:0 40px 8px;font-size:15px;line-height:1.6;color:#374151">
              Hi ${name},
            </td>
          </tr>

          <!-- Description -->
          <tr>
            <td style="padding:0 40px 24px;font-size:15px;line-height:1.6;color:#374151">
              ${requestor} has requested the deletion of the <strong>${workspace}</strong> workspace. This is a permanent action that cannot be undone after the grace period.
            </td>
          </tr>

          <!-- Details box -->
          <tr>
            <td style="padding:0 40px 24px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#fef2f2;border-radius:8px;border-left:4px solid #ef4444;padding:16px 20px">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;padding:0 0 4px">WORKSPACE</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px;color:#111827;padding:0 0 12px">${workspace}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;padding:0 0 4px">REQUESTED BY</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px;color:#111827;padding:0 0 12px">${requestor}</td>
                      </tr>
                      ${reasonBlock}
                      <tr>
                        <td style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;padding:0 0 4px">DELETION DATE</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px;color:#111827;padding:0 0 12px">${formattedDeletionDate} (${daysUntilDeletion} days from now)</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;padding:0 0 4px">CANCELLATION DEADLINE</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px;color:#111827;padding:0">${formattedCancelDate}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- What happens next -->
          <tr>
            <td style="padding:0 40px 8px;font-size:15px;font-weight:600;line-height:1.6;color:#374151">
              What happens next:
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 24px;font-size:14px;line-height:1.8;color:#374151">
              1. You can cancel this deletion until ${formattedCancelDate}<br />
              2. After the grace period, all data will be archived and encrypted<br />
              3. The workspace and all associated data will be permanently deleted<br />
              4. Billing records will be retained for 7 years per legal requirements
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding:8px 40px 24px">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${appUrl}/settings/danger-zone" style="height:44px;v-text-anchor:middle;width:220px" arcsize="14%" fillcolor="#ef4444" strokecolor="#ef4444" strokeweight="0">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:600">View Deletion Status</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${appUrl}/settings/danger-zone" target="_blank" style="display:inline-block;background-color:#ef4444;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:6px;line-height:1.5">View Deletion Status</a>
              <!--<![endif]-->
            </td>
          </tr>

          <!-- Warning box -->
          <tr>
            <td style="padding:0 40px 24px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#fffbeb;border-radius:8px;border-left:4px solid #f59e0b;padding:16px 20px">
                    <strong style="color:#92400e;font-size:14px">Want to cancel?</strong>
                    <p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#374151">If this deletion was made in error, you can cancel it from the workspace settings before ${formattedCancelDate}. After this date, the deletion cannot be stopped.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Help text -->
          <tr>
            <td align="center" style="padding:0 40px 24px;font-size:14px;color:#6b7280">
              Questions? <a href="mailto:support@getzygo.com" style="color:#4f46e5;text-decoration:none">Contact support</a>
            </td>
          </tr>

          <!-- Signature -->
          <tr>
            <td style="padding:0 40px 32px;font-size:15px;line-height:1.6;color:#374151">
              Best,<br />The Zygo Team
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:0 40px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #e5e7eb;padding-top:24px"></td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 16px;font-size:13px;color:#6b7280">
              <a href="https://getzygo.com/privacy" style="color:#4f46e5;text-decoration:none">Privacy Policy</a>
              &nbsp;&bull;&nbsp;
              <a href="https://getzygo.com/terms" style="color:#4f46e5;text-decoration:none">Terms of Service</a>
              &nbsp;&bull;&nbsp;
              <a href="mailto:support@getzygo.com" style="color:#4f46e5;text-decoration:none">Contact Support</a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 8px;font-size:12px;line-height:1.5;color:#9ca3af">
              ZYGO AI Technologies<br />Budapest, Hungary
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 32px;font-size:12px;color:#9ca3af">
              &copy; ${year} Zygo. All rights reserved.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export default TenantDeletionRequested;
