import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Link,
  Hr,
  Section,
} from "@react-email/components";
import { marked } from "marked";

// Convert markdown to HTML
function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

interface SuccessEmailProps {
  summary: string;
  filesChanged: string[];
  prUrl?: string;
  previewUrls?: string[];
  branchName: string;
}

export function SuccessEmail({
  summary,
  filesChanged,
  prUrl,
  previewUrls,
  branchName,
}: SuccessEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section>
            <Text style={heading}>Summary</Text>
            <div
              style={markdownContent}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
            />
          </Section>

          {filesChanged.length > 0 && (
            <Section>
              <Text style={heading}>Changes</Text>
              {filesChanged.map((file, index) => (
                <Text key={index} style={listItem}>
                  • {file}
                </Text>
              ))}
            </Section>
          )}

          <Section>
            <Text style={heading}>Links</Text>
            {prUrl && (
              <Text style={listItem}>
                • PR: <Link href={prUrl} style={link}>{prUrl}</Link>
              </Text>
            )}
            {previewUrls && previewUrls.length > 0 && previewUrls.map((url, index) => (
              <Text key={index} style={listItem}>
                • Preview: <Link href={url} style={link}>{url}</Link>
              </Text>
            ))}
            <Text style={listItem}>• Branch: {branchName}</Text>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            Reply to this email to continue the conversation.
          </Text>
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
  fontSize: "16px",
  fontWeight: "600" as const,
  color: "#1a1a1a",
  margin: "24px 0 8px 0",
};

const text = {
  fontSize: "14px",
  lineHeight: "24px",
  color: "#333333",
  margin: "0 0 16px 0",
};

const markdownContent = {
  fontSize: "14px",
  lineHeight: "24px",
  color: "#333333",
  margin: "0 0 16px 0",
};

const listItem = {
  fontSize: "14px",
  lineHeight: "24px",
  color: "#333333",
  margin: "0",
  paddingLeft: "8px",
};

const link = {
  color: "#0066cc",
  textDecoration: "underline",
};

const hr = {
  borderColor: "#e6e6e6",
  margin: "24px 0",
};

const footer = {
  fontSize: "13px",
  color: "#666666",
  margin: "0",
};

export default SuccessEmail;
