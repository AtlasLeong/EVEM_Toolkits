class LicenseDatabaseRouter:
    """把 License 应用的数据读写和迁移固定到独立授权库。"""

    app_label = 'License'

    def db_for_read(self, model, **hints):
        if model._meta.app_label == self.app_label:
            return 'license'
        return None

    def db_for_write(self, model, **hints):
        if model._meta.app_label == self.app_label:
            return 'license'
        return None

    def allow_relation(self, obj1, obj2, **hints):
        labels = {obj1._meta.app_label, obj2._meta.app_label}
        if self.app_label in labels:
            return labels == {self.app_label}
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if app_label == self.app_label:
            return db == 'license'
        if db == 'license':
            return False
        return None

