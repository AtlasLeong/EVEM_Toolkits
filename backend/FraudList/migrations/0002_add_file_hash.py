from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('FraudList', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE fraud_evidence_flow
                ADD COLUMN file_hash VARCHAR(32) NULL,
                ADD INDEX idx_file_hash (file_hash);
            """,
            reverse_sql="""
                ALTER TABLE fraud_evidence_flow
                DROP INDEX idx_file_hash,
                DROP COLUMN file_hash;
            """
        ),
    ]
