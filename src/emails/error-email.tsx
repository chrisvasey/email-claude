import {
	Body,
	Container,
	Head,
	Hr,
	Html,
	Section,
	Text,
} from "@react-email/components";
import { marked } from "marked";

// Convert markdown to HTML
function renderMarkdown(text: string): string {
	return marked.parse(text, { async: false }) as string;
}

interface ErrorEmailProps {
	errorMessage: string;
}

export function ErrorEmail({ errorMessage }: ErrorEmailProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Section>
						<Text style={heading}>Error</Text>
						<Text style={text}>
							An error occurred while processing your request:
						</Text>
						<div
							style={errorText}
							dangerouslySetInnerHTML={{ __html: renderMarkdown(errorMessage) }}
						/>
					</Section>

					<Hr style={hr} />

					<Text style={footer}>Reply to try again or start a new task.</Text>
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
	color: "#cc0000",
	margin: "24px 0 8px 0",
};

const text = {
	fontSize: "14px",
	lineHeight: "24px",
	color: "#333333",
	margin: "0 0 8px 0",
};

const errorText = {
	fontSize: "14px",
	lineHeight: "24px",
	color: "#333333",
	margin: "0 0 16px 0",
	padding: "12px",
	backgroundColor: "#f5f5f5",
	borderRadius: "4px",
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

export default ErrorEmail;
