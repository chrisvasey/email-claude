import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Hr,
  Section,
} from "@react-email/components";
import { marked } from "marked";

// Convert markdown to HTML
function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

interface PlanEmailProps {
  plan: string;
  isRevision?: boolean;
}

export function PlanEmail({ plan, isRevision = false }: PlanEmailProps) {
  const title = isRevision ? "Revised Plan" : "Implementation Plan";

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section>
            <Text style={heading}>{title}</Text>
            <div
              style={markdownContent}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(plan) }}
            />
          </Section>

          <Hr style={hr} />

          <Section>
            <Text style={subheading}>Next Steps</Text>
            <Text style={instructionText}>
              To <strong>approve</strong> this plan, reply with:
            </Text>
            <Text style={listItem}>
              - [confirm] in the subject, OR
            </Text>
            <Text style={listItem}>
              - "Looks good", "Approved", "Go ahead", etc.
            </Text>
            <Text style={instructionText}>
              To <strong>request changes</strong>, simply reply with your feedback.
            </Text>
            <Text style={instructionText}>
              To <strong>cancel</strong>, reply with [cancel] in the subject.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#ffffff",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const container = {
  margin: "0 auto",
  padding: "20px 0 48px",
  maxWidth: "600px",
};

const heading = {
  fontSize: "18px",
  fontWeight: "600" as const,
  color: "#1a1a1a",
  margin: "0 0 16px 0",
};

const subheading = {
  fontSize: "16px",
  fontWeight: "600" as const,
  color: "#1a1a1a",
  margin: "0 0 8px 0",
};

const markdownContent = {
  fontSize: "14px",
  lineHeight: "24px",
  color: "#333333",
  margin: "0 0 16px 0",
};

const instructionText = {
  fontSize: "14px",
  lineHeight: "20px",
  color: "#333333",
  margin: "8px 0",
};

const listItem = {
  fontSize: "14px",
  lineHeight: "20px",
  color: "#666666",
  margin: "0",
  paddingLeft: "16px",
};

const hr = {
  borderColor: "#e6e6e6",
  margin: "24px 0",
};

export default PlanEmail;
