import {
	Body,
	Container,
	Head,
	Hr,
	Html,
	Section,
	Text,
} from "@react-email/components";

interface BranchNoticeEmailProps {
	previousBranch: string;
	defaultBranch: string;
	newBranch: string;
	projectName: string;
}

export function BranchNoticeEmail({
	previousBranch,
	defaultBranch,
	newBranch,
	projectName,
}: BranchNoticeEmailProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Section>
						<Text style={heading}>Notice: Branch Reset</Text>
						<Text style={text}>
							The repository <strong>{projectName}</strong> was on branch{" "}
							<code style={code}>{previousBranch}</code> instead of{" "}
							<code style={code}>{defaultBranch}</code>.
						</Text>
						<Text style={text}>
							For safety, we switched to{" "}
							<code style={code}>{defaultBranch}</code> before creating your
							feature branch <code style={code}>{newBranch}</code>.
						</Text>
						<Text style={text}>
							Your request is being processed normally from the latest{" "}
							<code style={code}>{defaultBranch}</code> state.
						</Text>
					</Section>

					<Hr style={hr} />

					<Text style={footer}>
						This is an informational notice. No action is required.
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
	color: "#cc6600",
	margin: "24px 0 8px 0",
};

const text = {
	fontSize: "14px",
	lineHeight: "24px",
	color: "#333333",
	margin: "0 0 16px 0",
};

const code = {
	backgroundColor: "#f4f4f4",
	padding: "2px 6px",
	borderRadius: "3px",
	fontFamily: "monospace",
	fontSize: "13px",
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

export default BranchNoticeEmail;
