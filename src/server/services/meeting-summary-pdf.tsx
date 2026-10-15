import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

export interface MeetingSummary {
  resumen: string;
  puntosClave: string[];
  decisiones: string[];
  proximosPasos: string[];
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#666666", marginBottom: 20 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 18, marginBottom: 8 },
  paragraph: { fontSize: 11, lineHeight: 1.5 },
  listItem: { fontSize: 11, lineHeight: 1.5, marginBottom: 4, flexDirection: "row" },
  bullet: { width: 12 },
  empty: { fontSize: 10, color: "#999999", fontStyle: "italic" },
});

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <Text style={styles.empty}>(sin datos)</Text>;
  }
  return (
    <View>
      {items.map((item, i) => (
        <View key={i} style={styles.listItem}>
          <Text style={styles.bullet}>•</Text>
          <Text>{item}</Text>
        </View>
      ))}
    </View>
  );
}

/** Arma el PDF en el servidor con componentes declarativos — sin necesitar un navegador headless. */
export async function renderMeetingSummaryPdf(options: {
  title: string;
  scheduledAt: Date;
  summary: MeetingSummary;
}): Promise<Buffer> {
  const { title, scheduledAt, summary } = options;

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>
          Resumen generado a partir de la transcripción — reunión del {scheduledAt.toLocaleDateString("es")}
        </Text>

        <Text style={styles.sectionTitle}>Resumen</Text>
        <Text style={styles.paragraph}>{summary.resumen}</Text>

        <Text style={styles.sectionTitle}>Puntos clave</Text>
        <BulletList items={summary.puntosClave} />

        <Text style={styles.sectionTitle}>Decisiones</Text>
        <BulletList items={summary.decisiones} />

        <Text style={styles.sectionTitle}>Próximos pasos</Text>
        <BulletList items={summary.proximosPasos} />
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
