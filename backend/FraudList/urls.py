from django.urls import path
from .views import (FraudListSearch, FraudAdminCheck, AdminFraudList, GetFraudAdminUserGroup, GetAdminBehaviorFlow,
                    UploadImageView, FraudListReport, FraudAdminListReport)

urlpatterns = [
    path('fraudsearch', FraudListSearch.as_view(), name='fraud_list_search'),
    path('fraudadmincheck', FraudAdminCheck.as_view(), name='fraud_admin_check'),
    path('fraudadminlist', AdminFraudList.as_view(), name='admin_fraud_list'),
    path('fraudadmingroup', GetFraudAdminUserGroup.as_view(), name='get_fraud_admin_user_group'),
    path('fraudbehaviorflow', GetAdminBehaviorFlow.as_view(), name='fraud_behavior_flow'),
    path('uploadimage/', UploadImageView.as_view(), name='upload-image'),
    path('fraudlistreport', FraudListReport.as_view(), name='fraud_list_report'),
    path('fraudadminlistreport', FraudAdminListReport.as_view(), name='fraud_list_report_admin'),
]
