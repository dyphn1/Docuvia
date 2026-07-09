// Shared constants for the Integrations page and its sub-components:
// Integrations.tsx, integrations/components/CreateIntegrationForm.tsx,
// integrations/components/IntegrationCard.tsx

import type { ProjectIntegrationIntegrationType } from "@workspace/api-client-react";

// --- Integrations.tsx ---
export const INTEGRATION_SKELETON_COUNT = 3;

export const INTEGRATIONS_PAGE_TITLE = "Integrations";
export const INTEGRATIONS_PAGE_SUBTITLE =
  "Forward Docuvia notifications to Slack or Microsoft Teams channels via incoming webhooks";

export const SELECT_PROJECT_TITLE = "Select Project";
export const SELECT_PROJECT_INTEGRATIONS_DESCRIPTION =
  "Choose a project to view and manage its webhook integrations";
export const SELECT_PROJECT_PLACEHOLDER = "Select a project…";

export const CONFIGURED_WEBHOOKS_TITLE = "Configured Webhooks";
export const CONFIGURED_WEBHOOKS_DESCRIPTION =
  "Toggle, test, or remove webhook integrations for this project";
export const NO_INTEGRATIONS_MESSAGE =
  "No integrations configured yet. Add one above to start forwarding notifications.";

// --- CreateIntegrationForm.tsx ---
export const WEBHOOK_URL_HTTPS_PREFIX = "https://";
export const WEBHOOK_URL_REQUIRED_MESSAGE = "Webhook URL is required.";
export const WEBHOOK_URL_HTTPS_REQUIRED_MESSAGE = `Webhook URL must start with ${WEBHOOK_URL_HTTPS_PREFIX}`;
export const WEBHOOK_URL_INVALID_FORMAT_MESSAGE = "Invalid URL format.";
export const INTEGRATION_ADDED_TOAST = "Integration added successfully";
export const INTEGRATION_ADD_FAILED_TOAST = "Failed to add integration";

export const ADD_INTEGRATION_TITLE = "Add Integration";
export const ADD_INTEGRATION_DESCRIPTION =
  "Configure a new Slack or Teams webhook for this project";
export const INTEGRATION_TYPE_LABEL = "Type";
export const INTEGRATION_ENABLED_LABEL = "Enabled";
export const INTEGRATION_ENABLE_ON_CREATION_ARIA_LABEL = "Enable on creation";
export const WEBHOOK_URL_LABEL = "Webhook URL";
export const WEBHOOK_URL_PLACEHOLDER = "https://hooks.slack.com/services/…";
export const ADD_INTEGRATION_BUTTON_TEXT = "Add Integration";

export const INTEGRATION_TYPE_OPTION_LABELS: Record<ProjectIntegrationIntegrationType, string> = {
  slack: "Slack",
  teams: "Microsoft Teams",
};

// --- IntegrationCard.tsx ---
// Tailwind JIT requires literal (non-interpolated) class strings, so brand colors are
// kept as full class strings here rather than composed from a hex constant.
export const INTEGRATION_BADGE_STYLES: Record<ProjectIntegrationIntegrationType, string> = {
  slack: "text-[#4A154B] border-[#4A154B]/30 bg-[#4A154B]/5",
  teams: "text-[#005BA1] border-[#005BA1]/30 bg-[#005BA1]/5",
};
export const INTEGRATION_BADGE_LABELS: Record<ProjectIntegrationIntegrationType, string> = {
  slack: "Slack",
  teams: "Teams",
};
export const WEBHOOK_URL_DISPLAY_MAX_LENGTH = 60;
export const WEBHOOK_URL_TRUNCATE_LENGTH = WEBHOOK_URL_DISPLAY_MAX_LENGTH - 3;

export const INTEGRATION_UPDATE_FAILED_TOAST = "Failed to update integration";
export const INTEGRATION_DELETED_TOAST = "Integration deleted";
export const INTEGRATION_DELETE_FAILED_TOAST = "Failed to delete integration";
export const INTEGRATION_TEST_SUCCESS_TOAST = "Test message sent successfully!";
export const INTEGRATION_TEST_FAILED_TOAST_TITLE = "Test failed";
export const INTEGRATION_TEST_FAILED_DEFAULT_DESCRIPTION = "Webhook returned an error.";
export const INTEGRATION_TEST_REQUEST_FAILED_TOAST = "Test request failed";

export const INTEGRATION_TOGGLE_ENABLED_ARIA_LABEL = "Toggle enabled";
export const INTEGRATION_SEND_TEST_TITLE = "Send a test notification";
export const INTEGRATION_TEST_BUTTON_TEXT = "Test";
export const INTEGRATION_DELETE_TITLE = "Delete integration";
export const INTEGRATION_DELETE_CONFIRM_TITLE = "Delete integration?";
export const INTEGRATION_DELETE_CONFIRM_DESCRIPTION_PREFIX = "This will permanently remove the";
export const INTEGRATION_DELETE_CONFIRM_DESCRIPTION_SUFFIX =
  "webhook. Notifications will no longer be sent to this endpoint.";
export const INTEGRATION_DELETE_CANCEL_TEXT = "Cancel";
export const INTEGRATION_DELETE_CONFIRM_BUTTON_TEXT = "Delete";
export const INTEGRATION_ADDED_DATE_PREFIX = "Added";
