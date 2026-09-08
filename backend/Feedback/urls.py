from django.urls import path

from .views import FeedbackAttachmentDownload, FeedbackAttachments, FeedbackComments, FeedbackDetail, FeedbackList

urlpatterns = [
    path('', FeedbackList.as_view(), name='feedback-list'),
    path('<int:pk>/', FeedbackDetail.as_view(), name='feedback-detail'),
    path('<int:pk>/comments/', FeedbackComments.as_view(), name='feedback-comments'),
    path('<int:pk>/attachments/', FeedbackAttachments.as_view(), name='feedback-attachments'),
    path('<int:pk>/attachments/<int:attachment_id>/download/', FeedbackAttachmentDownload.as_view(), name='feedback-attachment-download'),
]
