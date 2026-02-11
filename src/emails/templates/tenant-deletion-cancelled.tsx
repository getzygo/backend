/**
 * Tenant Deletion Cancelled Template
 *
 * Sent to all workspace members when deletion is cancelled.
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

interface TenantDeletionCancelledProps {
  firstName?: string;
  tenantName?: string;
  cancelledBy?: string;
  cancelledAt?: Date;
  appUrl?: string;
}

export function TenantDeletionCancelled({
  firstName = 'there',
  tenantName = 'Your workspace',
  cancelledBy = 'an administrator',
  cancelledAt = new Date(),
  appUrl = 'https://app.getzygo.com',
}: TenantDeletionCancelledProps): string {
  const formattedDate = cancelledAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const name = escapeHtml(firstName);
  const workspace = escapeHtml(tenantName);
  const canceller = escapeHtml(cancelledBy);
  const year = new Date().getFullYear();

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Workspace Deletion Cancelled</title>
  <!--[if mso]>
  <style type="text/css">
    table { border-collapse: collapse; }
    .button-link { padding: 12px 24px !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
  <!-- Preview text -->
  <div style="display:none;max-height:0;overflow:hidden">Good news! The deletion of ${workspace} has been cancelled</div>

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
              <h1 style="margin:0;font-size:24px;font-weight:600;color:#111827">Workspace deletion cancelled</h1>
            </td>
          </tr>

          <!-- Success alert box -->
          <tr>
            <td style="padding:16px 40px 24px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#f0fdf4;border-radius:8px;border-left:4px solid #10b981;padding:16px 20px">
                    <strong style="color:#065f46;font-size:14px">Good News</strong>
                    <p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#374151">The scheduled deletion of &ldquo;${workspace}&rdquo; has been cancelled. Your workspace and all data remain intact.</p>
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
              Great news! The deletion request for the <strong>${workspace}</strong> workspace has been cancelled. Your workspace is now restored to normal operation.
            </td>
          </tr>

          <!-- Details box -->
          <tr>
            <td style="padding:0 40px 24px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#f0fdf4;border-radius:8px;border-left:4px solid #10b981;padding:16px 20px">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;padding:0 0 4px">WORKSPACE</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px;color:#111827;padding:0 0 12px">${workspace}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;padding:0 0 4px">CANCELLED BY</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px;color:#111827;padding:0 0 12px">${canceller}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;padding:0 0 4px">CANCELLED AT</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px;color:#111827;padding:0 0 12px">${formattedDate}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;padding:0 0 4px">STATUS</td>
                      </tr>
                      <tr>
                        <td style="font-size:14px;color:#111827;padding:0">Active</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- What this means -->
          <tr>
            <td style="padding:0 40px 8px;font-size:15px;font-weight:600;line-height:1.6;color:#374151">
              What this means:
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 24px;font-size:14px;line-height:1.8;color:#374151">
              1. Your workspace is fully operational again<br />
              2. All data, settings, and configurations are preserved<br />
              3. Team members can continue working as normal<br />
              4. Your billing and subscription remain unchanged
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding:8px 40px 24px">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${appUrl}/dashboard" style="height:44px;v-text-anchor:middle;width:200px" arcsize="14%" fillcolor="#10b981" strokecolor="#10b981" strokeweight="0">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:600">Go to Dashboard</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${appUrl}/dashboard" target="_blank" style="display:inline-block;background-color:#10b981;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:6px;line-height:1.5">Go to Dashboard</a>
              <!--<![endif]-->
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

export default TenantDeletionCancelled;
